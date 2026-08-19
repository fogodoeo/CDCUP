"""Band auction monitor bootstrap.

The original Python 3.13 bytecode is preserved in
``__pycache__/band_monitor_app_core.cpython-313.pyc``.  This file loads that
known-good core and applies small runtime patches for lower Chrome/printing
load.
"""
from __future__ import annotations

import builtins
import base64
from collections import deque
import hashlib
import hmac
import json
import importlib.util
import marshal
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import threading
import types
import unicodedata
import uuid

from auction_contract import checklist_meta as _auction_checklist_meta
from auction_contract import parse_checklist as _parse_auction_checklist
from capture_client import CaptureClient, build_capture_payload
from label_spool import LabelSpool, label_display_text


_ORIGINAL_PRINT = builtins.print
_SUPPRESS_PRINT = object()
_MOJIBAKE_MARKERS = (
    "諛", "遺", "紐", "寃", "釉", "쇱", "쒗", "꾨", "\x80",
    "?낆", "?쒗", "?꾨", "?쇰", "?뺣", "?좎", "?ㅼ", "?섏",
)


def _configure_console_output():
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleCP(65001)
        except Exception:
            pass
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _clean_console_text(value):
    text = str(value)
    if any(marker in text for marker in _MOJIBAKE_MARKERS):
        return _SUPPRESS_PRINT
    # Suppress Chrome debugging tab list prints
    if text.startswith("  ") and any(x in text for x in ("▶", "??", "http", "/json", "127.0.0.1")):
        return _SUPPRESS_PRINT
    return text


def _safe_print(*args, **kwargs):
    target = kwargs.get("file")
    if target is None or target in (sys.stdout, sys.stderr):
        cleaned = tuple(_clean_console_text(arg) for arg in args)
        if any(arg is _SUPPRESS_PRINT for arg in cleaned):
            return
        args = cleaned
    _ORIGINAL_PRINT(*args, **kwargs)


def _crash_report_excepthook(exctype, value, traceback):
    import traceback as tb
    from datetime import datetime
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        log_dir = os.path.join(base_dir, "print_outputs")
        os.makedirs(log_dir, exist_ok=True)
        crash_log = os.path.join(log_dir, "crash_report.log")
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(f"\n=========================================\n")
            f.write(f"Crash Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            tb.print_exception(exctype, value, traceback, file=f)
    except Exception:
        pass
    tb.print_exception(exctype, value, traceback, file=sys.__stderr__ or sys.stderr)
    sys.exit(1)


_configure_console_output()
builtins.print = _safe_print
sys.excepthook = _crash_report_excepthook


APP_DIR = os.path.dirname(os.path.abspath(__file__))
LABEL_SPOOL_PATH = os.path.join(APP_DIR, "print_outputs", "label_print_spool.json")
ACTIVE_AUCTION_SESSION_PATH = os.path.join(APP_DIR, "print_outputs", "active_auction_session.json")
_LABEL_SPOOL = LabelSpool(LABEL_SPOOL_PATH)
BID_SAVE_MIN_INTERVAL_SEC = 2.0
MAX_SEEN_CHAT_KEYS = 4000
KEEP_SEEN_CHAT_KEYS = 3000
MAX_BID_TABLE_ROWS = 200
AUCTION_COUNTDOWN_ANNOUNCEMENT = (
    "⏳ 마감 카운트를 시작합니다. ⬜⬜⬜⬜⬜ 표시 이후의 입찰은 반영되지 않습니다."
)
AUCTION_COUNTDOWN_LOCK_MESSAGE = "⬜⬜⬜⬜⬜"
AUCTION_COUNTDOWN_LOCK_SEND_LABEL = "마감 잠금 표시 전송 실패"
AUCTION_COUNTDOWN_INITIAL_STAGES = (
    ("🟩🟩🟩🟩🟩", 5000),
    ("🟩🟩🟩🟩⬜", 5000),
    ("🟨🟨🟨⬜⬜", 7000),
    ("🟧🟧⬜⬜⬜", 8000),
    ("🟥⬜⬜⬜⬜", 8000),
)
AUCTION_COUNTDOWN_GREEN_STAGE_COUNT = 2
AUCTION_COUNTDOWN_RESUME_STAGES = AUCTION_COUNTDOWN_INITIAL_STAGES[2:]
AUCTION_COUNTDOWN_FIRST_MESSAGE_DELAY_MS = 850
AUCTION_COUNTDOWN_RESUME_DELAY_MS = 700
AUCTION_COUNTDOWN_IDLE = "idle"
AUCTION_COUNTDOWN_RUNNING = "running"
AUCTION_COUNTDOWN_LOCK_PENDING = "lock_pending"
AUCTION_COUNTDOWN_LOCKED = "locked"
CORE_PYC_CANDIDATES = [
    os.path.join(APP_DIR, "band_monitor_app_core.pyc"),
    os.path.join(APP_DIR, "__pycache__", "band_monitor_app_core.cpython-313.pyc"),
]
CORE_PYC = next((path for path in CORE_PYC_CANDIDATES if os.path.exists(path)), CORE_PYC_CANDIDATES[0])


def _load_core():
    if not os.path.exists(CORE_PYC):
        raise RuntimeError(f"App core cache was not found: {CORE_PYC}")

    with open(CORE_PYC, "rb") as f:
        data = f.read()

    if data[:4] != importlib.util.MAGIC_NUMBER:
        raise RuntimeError("The app core cache requires Python 3.13. Run this app with Python 3.13.")

    module = types.ModuleType("_band_monitor_app_core")
    module.__file__ = __file__
    module.__package__ = ""
    module.__loader__ = globals().get("__loader__")
    code = marshal.loads(data[16:])
    exec(code, module.__dict__)
    return module


_core = _load_core()


def _countdown_item_key(item):
    item = item or {}
    return str(item.get("row") or item.get("num") or "").strip()


def _countdown_top_signature(bids):
    bids = list(bids or [])
    if not bids:
        return None
    top = bids[0] or {}
    try:
        amount = float(top.get("amount", 0) or 0)
    except (TypeError, ValueError):
        amount = 0.0
    bidder = str(top.get("bidder_key") or top.get("name") or "").strip()
    return bidder, amount


def _dispatch_countdown_action(card):
    window = card.window() if card is not None else None
    handler = getattr(window, "_on_auction_countdown_action", None)
    if callable(handler):
        handler()


def _as_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


_EDITABLE_ANIMAL_CHECKLIST_KEYS = {
    "gender", "weight", "birth", "spot", "pin", "size", "wall",
    "color", "activity", "feed", "structure", "memo",
}
_SALE_CHECKLIST_KEYS = {
    "sale_mode", "sale_config_b64", "quiz_question_b64", "quiz_answer_b64",
    "quiz_price",
}
_SALE_MODE_DEFINITIONS = {
    "auction": {
        "label": "일반 경매",
        "start_label": "경매 시작",
        "confirm_label": "낙찰",
        "empty_label": "유찰",
    },
    "quiz": {
        "label": "퀴즈",
        "start_label": "퀴즈 시작",
        "confirm_label": "당첨 확정",
        "empty_label": "정답 없음",
        "required_config": ("question", "answer", "settlement_amount"),
    },
}
_VISIBILITY_MODE_DEFINITIONS = {
    "inherit": "자동",
    "public": "업체명 공개",
    "blind": "업체명 숨김",
}
_COMPETITION_MODE_LABELS = {
    "single": "단독",
    "tournament": "토너먼트",
}


def _parse_checklist_map(raw):
    return _parse_auction_checklist(raw)


def _encode_checklist_text(value):
    raw = str(value or "").encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_checklist_text(value):
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        padded = text + ("=" * (-len(text) % 4))
        return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return ""


def _encode_sale_config(config):
    payload = {"version": 2}
    payload.update(dict(config or {}))
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return _encode_checklist_text(raw)


def _decode_sale_config(value):
    raw = _decode_checklist_text(value)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_quiz_answer(value):
    return unicodedata.normalize("NFC", str(value or "").strip())


def _quiz_answer_secret(create=False):
    """Return the local-only secret used to verify quiz answers."""
    try:
        config = _core.load_config() or {}
        secret = str(config.get("quiz_answer_secret") or "").strip()
        if not secret and create:
            secret = secrets.token_urlsafe(32)
            config["quiz_answer_secret"] = secret
            _core.save_config(config)
        return secret
    except Exception:
        return ""


def _quiz_answer_digest(value, create_secret=False):
    answer = _normalize_quiz_answer(value)
    secret = _quiz_answer_secret(create=create_secret)
    if not answer or not secret:
        return ""
    return hmac.new(secret.encode("utf-8"), answer.encode("utf-8"), hashlib.sha256).hexdigest()


def _protect_quiz_config(config):
    protected = dict(config or {})
    answer = str(protected.pop("answer", "") or "").strip()
    if answer:
        digest = _quiz_answer_digest(answer, create_secret=True)
        if not digest:
            raise RuntimeError("퀴즈 정답 보안키를 저장하지 못했습니다.")
        protected["answer_digest"] = digest
    return protected


def _quiz_answer_matches(meta, value):
    digest = str((meta or {}).get("answer_digest") or "").strip()
    if digest:
        candidate = _quiz_answer_digest(value, create_secret=False)
        return bool(candidate) and hmac.compare_digest(candidate, digest)
    return _normalize_quiz_answer(value) == _normalize_quiz_answer((meta or {}).get("answer"))


def _sale_item_meta(item):
    values = _parse_checklist_map((item or {}).get("checklist", ""))
    mode = str(values.get("sale_mode") or "auction").strip().lower()
    if mode not in _SALE_MODE_DEFINITIONS:
        mode = "auction"
    config = _decode_sale_config(values.get("sale_config_b64", ""))

    # Read the first quiz implementation as a migration fallback. New saves
    # use one versioned config object so future sale modes can add settings
    # without adding more checklist keys or database columns.
    if mode == "quiz":
        if not config.get("question"):
            config["question"] = _decode_checklist_text(values.get("quiz_question_b64", ""))
        if not config.get("answer"):
            config["answer"] = _decode_checklist_text(values.get("quiz_answer_b64", ""))
        if config.get("settlement_amount") in (None, ""):
            config["settlement_amount"] = values.get("quiz_price", "")

    return {
        "mode": mode,
        "definition": _SALE_MODE_DEFINITIONS[mode],
        "config": config,
    }


def _competition_mode(item):
    values = _parse_checklist_map((item or {}).get("checklist", ""))
    stored_type = str(values.get("_auction") or "").strip().lower()
    if stored_type == "tournament" or any(values.get(key) for key in ("_slot", "_team", "_stage")):
        return "tournament"
    return "single"


def _visibility_mode(item):
    values = _parse_checklist_map((item or {}).get("checklist", ""))
    mode = str(values.get("_visibility") or "").strip().lower()
    return mode if mode in {"public", "blind"} else "inherit"


def _replace_visibility_checklist(raw, mode="inherit"):
    mode = str(mode or "inherit").strip().lower()
    if mode not in _VISIBILITY_MODE_DEFINITIONS:
        mode = "inherit"
    preserved = []
    for part in str(raw or "").split("|"):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        key = key.strip()
        if not key or key == "_visibility":
            continue
        preserved.append(f"{key}:{value.strip()}")
    if mode != "inherit":
        preserved.append(f"_visibility:{mode}")
    return "|".join(preserved)


def _replace_sale_mode_checklist(raw, mode="auction", config=None):
    mode = str(mode or "auction").strip().lower()
    if mode not in _SALE_MODE_DEFINITIONS:
        mode = "auction"
    preserved = []
    for part in str(raw or "").split("|"):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        key = key.strip()
        if not key or key in _SALE_CHECKLIST_KEYS:
            continue
        preserved.append(f"{key}:{value.strip()}")
    if mode != "auction":
        stored_config = _protect_quiz_config(config) if mode == "quiz" else dict(config or {})
        preserved.extend([
            f"sale_mode:{mode}",
            f"sale_config_b64:{_encode_sale_config(stored_config)}",
        ])
    return "|".join(preserved)


def _merge_checklist_after_edit(original_raw, edited_raw, mode="auction", config=None):
    """Keep routing/custom metadata while replacing user-editable animal fields."""
    edited_parts = []
    edited_keys = set()
    for part in str(edited_raw or "").split("|"):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        key = key.strip()
        if not key or key in _SALE_CHECKLIST_KEYS:
            continue
        edited_keys.add(key)
        edited_parts.append(f"{key}:{value.strip()}")

    for part in str(original_raw or "").split("|"):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        key = key.strip()
        if (
            not key
            or key in edited_keys
            or key in _EDITABLE_ANIMAL_CHECKLIST_KEYS
            or key in _SALE_CHECKLIST_KEYS
        ):
            continue
        edited_parts.append(f"{key}:{value.strip()}")

    return _replace_sale_mode_checklist("|".join(edited_parts), mode, config)


def _quiz_item_meta(item):
    meta = _sale_item_meta(item)
    config = meta.get("config", {})
    return {
        "is_quiz": meta.get("mode") == "quiz",
        "question": str(config.get("question") or ""),
        "answer": str(config.get("answer") or ""),
        "answer_digest": str(config.get("answer_digest") or ""),
        "answer_configured": bool(config.get("answer") or config.get("answer_digest")),
        "settlement_amount": config.get("settlement_amount", ""),
    }


def _replace_quiz_checklist(raw, is_quiz, question="", answer="", settlement_amount=""):
    # Backward-compatible helper retained for local diagnostics and old calls.
    mode = "quiz" if is_quiz else "auction"
    config = {
        "question": str(question or "").strip(),
        "answer": str(answer or "").strip(),
        "settlement_amount": settlement_amount,
    }
    return _replace_sale_mode_checklist(raw, mode, config)


def _parse_settlement_amount(value):
    if isinstance(value, (int, float)):
        amount = float(value)
    else:
        text = unicodedata.normalize("NFKC", str(value or "")).strip().replace(",", "")
        if not text:
            raise ValueError("empty amount")
        is_won = text.endswith("원") and not text.endswith("만원")
        text = re.sub(r"\s*(만원|만|원)\s*$", "", text).strip()
        amount = float(text)
        if is_won:
            amount /= 10000
    if amount <= 0:
        raise ValueError("amount must be positive")
    return amount


def _settlement_amount_text(value):
    amount = _parse_settlement_amount(value)
    return str(int(amount)) if amount.is_integer() else str(amount).rstrip("0").rstrip(".")


def _sync_auction_animation_config(config, manager=None):
    """Publish the local Band-monitor animation switch to the broadcast config."""
    url = str(config.get("supabase_url", "") or "").rstrip("/")
    key = str(config.get("supabase_key", "") or "")
    is_channel_aware = bool(getattr(manager, "channel_aware", False))
    if is_channel_aware and getattr(manager, "using_platform", False):
        def _platform_worker():
            try:
                manager.update_broadcast_config({"auction_animation_enabled": value})
            except Exception as exc:
                print(f"[BroadcastMotion] channel config sync failed: {exc}")

        threading.Thread(target=_platform_worker, daemon=True).start()
        return
    # If channel resolution failed, never guess that the legacy CDCUP config is
    # the intended target. That would make an outage mutate another broadcast.
    if is_channel_aware and not getattr(manager, "_context_verified", False):
        print("[BroadcastMotion] active channel is not verified; config sync skipped", flush=True)
        return
    if not url or not key:
        return
    value = "1" if _as_bool(config.get("auction_animation_enabled"), True) else "0"

    def _worker():
        try:
            import requests
            response = requests.post(
                f"{url}/rest/v1/config",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal,resolution=merge-duplicates",
                },
                json=[{"key": "auction_animation_enabled", "value": value}],
                timeout=8,
            )
            response.raise_for_status()
        except Exception as exc:
            print(f"[BroadcastMotion] config sync failed: {exc}")

    threading.Thread(target=_worker, daemon=True).start()


def _queue_capture_job(window, item, sold_price="", winner="", manual=False):
    """Queue a PRISM still capture without delaying the accepted auction result."""
    config = getattr(window, "config", {}) or {}
    if not manual and not _as_bool(config.get("auto_capture_enabled"), False):
        return
    client = CaptureClient(
        config.get("capture_service_url"),
        config.get("capture_agent_token"),
        config.get("capture_channel_id") or "auto",
    )
    try:
        client.validate()
        payload = build_capture_payload(
            item,
            sold_price=sold_price,
            winner=winner,
            manual=manual,
            start_marker=getattr(window, "auction_start_time", ""),
            channel_id=client.channel_id,
        )
    except Exception as exc:
        print(f"[Capture] 캡처 설정 오류: {exc}", flush=True)
        return

    window.toast.show_toast(
        f"#{payload['itemNumber']} {payload['itemName']} 캡처 요청 중...",
        "info",
    )

    class CaptureRequestThread(_core.QThread):
        sig_queued = _core.pyqtSignal(str)
        sig_error = _core.pyqtSignal(str)

        def run(self):
            try:
                result = client.queue(payload)
                if result.get("skipped"):
                    message = f"#{payload['itemNumber']} 기존 캡처를 유지했습니다."
                    print(f"[Capture] 종료 캡처 생략: {payload['itemNumber']} {payload['itemName']}", flush=True)
                    self.sig_queued.emit(message)
                    return
                print(f"[Capture] 요청 완료: {payload['itemNumber']} {payload['itemName']}", flush=True)
                self.sig_queued.emit(f"#{payload['itemNumber']} 캡처가 본체 대기열에 등록됐습니다.")
            except Exception as exc:
                print(f"[Capture] 요청 실패: {exc}", flush=True)
                self.sig_error.emit(str(exc))

    threads = getattr(window, "_capture_request_threads", None)
    if threads is None:
        threads = []
        window._capture_request_threads = threads
    thread = CaptureRequestThread(window)
    threads.append(thread)
    thread.sig_queued.connect(lambda message: window.toast.show_toast(message, "success"))
    thread.sig_error.connect(lambda message: window.toast.show_toast(message, "error"))

    def _discard_capture_thread():
        try:
            threads.remove(thread)
        except ValueError:
            pass

    thread.finished.connect(_discard_capture_thread)
    thread.start()


def _active_session_channel(window):
    manager = getattr(window, "sheets", None)
    return str(getattr(manager, "channel_id", "") or "").strip().lower()


def _save_active_auction_session(window, item):
    item = item or {}
    row = str(item.get("row") or item.get("id") or "").strip()
    if not row:
        return
    payload = {
        "row": row,
        "num": item.get("num") or 0,
        "name": item.get("name") or "",
        "start_time": item.get("start_time") or item.get("startTime") or "",
        "channel_id": _active_session_channel(window),
        "saved_at": time.time(),
    }
    target = ACTIVE_AUCTION_SESSION_PATH
    temporary = target + ".tmp"
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except OSError as exc:
        print(f"[AuctionSession] 진행 상태 저장 실패: {exc}", flush=True)


def _clear_active_auction_session():
    for path in (ACTIVE_AUCTION_SESSION_PATH, ACTIVE_AUCTION_SESSION_PATH + ".tmp"):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            print(f"[AuctionSession] 진행 상태 정리 실패: {exc}", flush=True)


def _load_active_auction_session():
    try:
        with open(ACTIVE_AUCTION_SESSION_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("invalid session payload")
        saved_at = float(payload.get("saved_at") or 0)
        if not saved_at or time.time() - saved_at > 12 * 60 * 60:
            _clear_active_auction_session()
            return None
        return payload
    except FileNotFoundError:
        return None
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"[AuctionSession] 진행 상태 읽기 실패: {exc}", flush=True)
        _clear_active_auction_session()
        return None


def _restore_active_auction_session(window, items):
    payload = _load_active_auction_session()
    if not payload or not items:
        return None
    saved_channel = str(payload.get("channel_id") or "").strip().lower()
    current_channel = _active_session_channel(window)
    if saved_channel and current_channel and saved_channel != current_channel:
        return None
    saved_row = str(payload.get("row") or "").strip()
    saved_num = str(payload.get("num") or "").strip()
    item = next(
        (
            candidate for candidate in items
            if str(candidate.get("row") or candidate.get("id") or "").strip() == saved_row
            or (not saved_row and saved_num and str(candidate.get("num") or "").strip() == saved_num)
        ),
        None,
    )
    if not item:
        return None
    status = str(item.get("status") or "").strip()
    terminal = {_core.S_SOLD, _core.S_UNSOLD, _core.S_CANCEL}
    if status in terminal:
        _clear_active_auction_session()
        return None
    if status not in {_core.S_WAIT, _core.S_ACTIVE}:
        return None
    item["status"] = _core.S_ACTIVE
    if payload.get("start_time"):
        item["start_time"] = payload["start_time"]
        item["startTime"] = payload["start_time"]
    if status != _core.S_ACTIVE:
        update = {
            "row": item.get("row") or item.get("id"),
            "status": _core.S_ACTIVE,
            "start_time": item.get("start_time") or "",
        }

        def _repair_remote_status():
            try:
                if not window.sheets.update_item(update):
                    print("[AuctionSession] 진행 상태 원격 복구 실패", flush=True)
            except Exception as exc:
                print(f"[AuctionSession] 진행 상태 원격 복구 실패: {exc}", flush=True)

        threading.Thread(target=_repair_remote_status, daemon=True).start()
    print(f"[AuctionSession] #{item.get('num', '')} {item.get('name', '')} 진행 상태 복원", flush=True)
    return item


def _as_float(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _now_text():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _chat_command_text(value):
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.replace("\ufeff", "").replace("\u200b", "").replace("\u200c", "").replace("\u200d", "")
    return text.strip()


def _normalize_winner_text(value):
    """Prefix standalone 8-digit mobile numbers with 010."""
    return re.sub(r"(?<!\d)(\d{8})(?!\d)", r"010\1", str(value or ""))


def _is_buy_now_text(value):
    return _chat_command_text(value) == "즉구"


def _append_chat_debug_log(message):
    try:
        log_dir = os.path.join(APP_DIR, "print_outputs")
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "chat_debug.log")
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{stamp}] {message}\n")
    except Exception:
        pass


def _patch_parse_bid():
    original_parse_bid = _core.parse_bid
    original_parse_winner = _core.parse_winner

    def parse_bid_with_buy_now(text):
        if _is_buy_now_text(text):
            _append_chat_debug_log(f"buy-now recognized text={text!r}")
            return 2.0
        return original_parse_bid(text)

    def parse_winner_with_normalized_phone(text):
        name, phone = original_parse_winner(_normalize_winner_text(text))
        digits = re.sub(r"[^0-9]", "", str(phone or ""))
        if len(digits) == 8:
            digits = "010" + digits
        return name, digits

    _core.parse_bid = parse_bid_with_buy_now
    _core.parse_winner = parse_winner_with_normalized_phone


# ── WebSocket-based chat listener (replaces DOM polling) ──

class _BandChatWSListener:
    """Intercepts Band chat messages via CDP WebSocket frame monitoring.
    This avoids heavy DOM queries and reads chat data directly from
    Band's internal WebSocket stream."""

    BAND_CHAT_CMD = 93001

    def __init__(self, cdp_port=9222):
        self.cdp_port = cdp_port
        self._messages = []
        self._lock = threading.Lock()
        self._ws = None
        self._thread = None
        self._running = False
        self._connected = False
        self._mutation_seq = 0
        self._msg_id = 0
        self._total_received = 0

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="BandChatWS")
        self._thread.start()

    def stop(self):
        self._running = False
        ws = self._ws
        if ws:
            try:
                ws.close()
            except Exception:
                pass

    def is_alive(self):
        return (
            self._running
            and self._thread is not None
            and self._thread.is_alive()
            and self._connected
        )

    def get_messages(self):
        """Return queued messages and clear the buffer."""
        with self._lock:
            msgs = self._messages[:]
            self._messages.clear()
            return msgs, self._mutation_seq

    def _find_band_tab_ws(self):
        try:
            import requests as _req
            tabs = _req.get(
                f"http://127.0.0.1:{self.cdp_port}/json", timeout=3
            ).json()
            for tab in tabs:
                url = tab.get("url", "")
                if "band.us" in url and tab.get("webSocketDebuggerUrl"):
                    return tab["webSocketDebuggerUrl"]
        except Exception:
            pass
        return None

    def _send_cmd(self, method, params=None):
        self._msg_id += 1
        cmd = {"id": self._msg_id, "method": method}
        if params:
            cmd["params"] = params
        ws = self._ws
        if ws:
            try:
                ws.send(json.dumps(cmd))
            except Exception:
                pass

    def _run(self):
        try:
            import websocket as _ws_lib
        except ImportError:
            print("[WS Chat] websocket-client not installed, falling back to DOM")
            self._running = False
            return

        while self._running:
            ws_url = self._find_band_tab_ws()
            if not ws_url:
                time.sleep(3)
                continue

            try:
                self._ws = _ws_lib.WebSocketApp(
                    ws_url,
                    on_message=self._on_ws_message,
                    on_open=self._on_ws_open,
                    on_error=self._on_ws_error,
                    on_close=self._on_ws_close,
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as exc:
                print(f"[WS Chat] run error: {exc}", flush=True)

            self._connected = False
            if self._running:
                time.sleep(2)

    def _on_ws_open(self, ws):
        self._connected = True
        self._send_cmd("Network.enable")
        print("[WS Chat] Connected — listening for chat frames", flush=True)
        _append_chat_debug_log("WS chat listener connected")

    def _on_ws_error(self, ws, error):
        err_str = str(error) if error else ""
        if "403" not in err_str:
            print(f"[WS Chat] error: {err_str[:120]}", flush=True)

    def _on_ws_close(self, ws, close_status_code=None, close_msg=None):
        self._connected = False

    def _on_ws_message(self, ws, raw):
        try:
            msg = json.loads(raw)
        except Exception:
            return

        if msg.get("method") != "Network.webSocketFrameReceived":
            return

        payload_str = (
            msg.get("params", {}).get("response", {}).get("payloadData", "")
        )
        if not payload_str or len(payload_str) < 10:
            return

        try:
            data = json.loads(payload_str)
        except Exception:
            return

        if data.get("cmd") != self.BAND_CHAT_CMD:
            return

        bdy = data.get("bdy", {})
        profile_str = bdy.get("profile", "{}")
        try:
            profile = (
                json.loads(profile_str)
                if isinstance(profile_str, str)
                else profile_str
            )
        except Exception:
            profile = {}

        name = profile.get("name", "")
        chat_msg = bdy.get("msg", "")
        member_key = (
            profile.get("member_key", "") or bdy.get("mbrKey", "")
        )
        msg_time_ms = bdy.get("msgTime", 0)

        if not name or not chat_msg:
            return

        self._mutation_seq += 1
        self._total_received += 1

        # Format time
        t = ""
        if msg_time_ms:
            try:
                t = time.strftime("%H:%M", time.localtime(msg_time_ms / 1000))
            except Exception:
                pass

        message_key = f"ws:{member_key}:{msg_time_ms}:{chat_msg}"

        formatted = {
            "name": name,
            "text": chat_msg,
            "time": t,
            "userKey": member_key,
            "messageKey": message_key,
        }

        with self._lock:
            self._messages.append(formatted)
            if len(self._messages) > 200:
                self._messages = self._messages[-100:]


def _patch_band_cdp():
    BandCDP = _core.BandCDP

    def _send_single_message(self, text):
        """Insert one message into BAND's contenteditable editor and send it.

        This retains the contenteditable-safe insertion logic for ordinary
        single-line messages.
        """
        normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
        safe_lines = json.dumps(normalized.split("\n"), ensure_ascii=False)
        safe_text = json.dumps(normalized, ensure_ascii=False)
        js = r"""
        (function(){
            function isVisible(el) {
                if (!el || !el.getBoundingClientRect) return false;
                var rect = el.getBoundingClientRect();
                if (rect.width < 1 || rect.height < 1) return false;
                var style = window.getComputedStyle(el);
                return !!style && style.display !== 'none' && style.visibility !== 'hidden';
            }

            function queryFirst(selectors, predicate) {
                for (var i = 0; i < selectors.length; i++) {
                    var nodes = document.querySelectorAll(selectors[i]);
                    for (var j = 0; j < nodes.length; j++) {
                        var node = nodes[j];
                        if (!isVisible(node)) continue;
                        if (!predicate || predicate(node)) return node;
                    }
                }
                return null;
            }

            var inputSelectors = [
                '.writingArea._editor[contenteditable]',
                '.writingArea[contenteditable]',
                '[contenteditable="true"]._editor',
                '[contenteditable="plaintext-only"]._editor',
                '[contenteditable="true"][role="textbox"]',
                '[contenteditable="plaintext-only"][role="textbox"]',
                '[contenteditable="true"][aria-label*="메시지"]',
                '[contenteditable="true"][aria-label*="채팅"]',
                '[contenteditable="true"][data-placeholder*="메시지"]',
                '[contenteditable="true"][data-placeholder*="채팅"]'
            ];
            var sendSelectors = [
                'button._sendBtn',
                'button.btnSendMessage',
                'button[type="submit"]',
                'button[aria-label*="전송"]',
                'button[aria-label*="send"]'
            ];
            var lines = __LINES__;
            var fullText = __TEXT__;
            var input = queryFirst(inputSelectors, function(node){
                return node.isContentEditable || !!node.getAttribute('contenteditable');
            });
            if (!input) return 'no_input';

            input.focus();
            try { document.execCommand('selectAll', false, null); } catch (e) {}
            try { document.execCommand('delete', false, null); } catch (e) {}
            while (input.firstChild) input.removeChild(input.firstChild);

            for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                if (lineIndex > 0) {
                    var insertedBreak = false;
                    try {
                        insertedBreak = document.execCommand('insertLineBreak', false, null);
                    } catch (e) {}
                    if (!insertedBreak) {
                        try {
                            insertedBreak = document.execCommand('insertHTML', false, '<br>');
                        } catch (e) {}
                    }
                    if (!insertedBreak) input.appendChild(document.createElement('br'));
                }
                if (lines[lineIndex]) {
                    var insertedText = false;
                    try {
                        insertedText = document.execCommand('insertText', false, lines[lineIndex]);
                    } catch (e) {}
                    if (!insertedText) input.appendChild(document.createTextNode(lines[lineIndex]));
                }
            }

            try {
                input.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    data: fullText,
                    inputType: 'insertText'
                }));
            } catch (e) {
                input.dispatchEvent(new Event('input', {bubbles: true}));
            }
            input.dispatchEvent(new Event('change', {bubbles: true}));

            var btn = queryFirst(sendSelectors, function(node){
                return !node.disabled && node.getAttribute('aria-disabled') !== 'true';
            });
            if (btn) {
                btn.click();
                return 'ok';
            }
            return 'no_button';
        })()
        """.replace("__LINES__", safe_lines).replace("__TEXT__", safe_text)
        return self.evaluate(js)

    def send_message_as_separate_lines(self, text):
        """Send logical lines as separate chat messages.

        BAND Live normalizes whitespace again after a message reaches the
        server, including ``<br>`` nodes created in the editor. Sending each
        logical line as its own message is the only reliable visual break.
        """
        normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
        normalized = normalized.replace("\\r\\n", "\n").replace("\\n", "\n")

        # The recovered core still creates this legacy string directly for
        # ordinary bids. Normalize it here so every automatic high-bid notice
        # uses the same compact one-line format.
        legacy_highest = re.fullmatch(r"\s*현재\s*최고가\s+(.+?)\s*\((.+)\)\s*", normalized)
        if legacy_highest:
            price_text, raw_winner = legacy_highest.groups()
            price_text = price_text.strip()
            if price_text.endswith("만"):
                price_text += "원"
            parsed_winner, _ = _core.parse_winner(raw_winner)
            display_winner = parsed_winner or raw_winner
            display_winner = re.sub(r"\s*[./|·]+\s*", " ", display_winner)
            display_winner = re.sub(r"\s+", " ", display_winner).strip()
            normalized = f"⠀⠀🔴 입찰 {price_text} {display_winner}⠀⠀"

        lines = [line.strip() for line in normalized.split("\n") if line.strip()]
        if not lines:
            return "empty"

        prepared_lines = []
        for line in lines:
            compact_sold = re.fullmatch(r"(⠀⠀)?(🟢|ㅤ )\s*([\d,.]+\s*만원?)\s+(.+)", line)
            if compact_sold:
                sold_indent, sold_marker, sold_price_text, raw_winner = compact_sold.groups()
                sold_price_text = re.sub(r"\s+", "", sold_price_text)
                if sold_price_text.endswith("만"):
                    sold_price_text += "원"
                parsed_winner, _ = _core.parse_winner(raw_winner)
                display_winner = parsed_winner or raw_winner
                display_winner = re.sub(r"\s*[./|·]+\s*", " ", display_winner)
                display_winner = re.sub(r"\s+", " ", display_winner).strip()
                sold_prefix = "🟢" if sold_marker == "🟢" else "ㅤ "
                line = f"{sold_indent or ''}{sold_prefix} {sold_price_text} {display_winner}"
            for winner_prefix in ("┃ 낙찰자 ", "┃ 입찰자 "):
                if line.startswith(winner_prefix):
                    raw_winner = line[len(winner_prefix):].strip()
                    parsed_winner, _ = _core.parse_winner(raw_winner)
                    line = f"{winner_prefix}{parsed_winner or raw_winner}"
                    break
            prepared_lines.append(line)

        result = "empty"
        for line_index, line in enumerate(prepared_lines):
            result = _send_single_message(self, line)
            if result != "ok":
                return result
            if line_index + 1 < len(prepared_lines):
                time.sleep(0.5)
        return result

    def _launch_chrome_light(self, cfg=None):
        if cfg is None:
            cfg = _core.load_config()

        chrome_paths = [
            r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
            r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
            r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
        ]
        chrome_exe = ""
        for path in chrome_paths:
            expanded = os.path.expandvars(path)
            if os.path.isfile(expanded):
                chrome_exe = expanded
                break

        if not chrome_exe:
            print("[CDP] Chrome executable was not found.")
            return False

        urls = ["https://band.us"]
        if _as_bool(cfg.get("chrome_open_aux_pages"), False):
            sheet_url = (cfg.get("sheet_url") or "").strip()
            if sheet_url:
                urls.append(sheet_url)
            webapp = (cfg.get("webapp_url") or "").strip()
            if webapp:
                base = webapp.split("?")[0]
                urls.extend([webapp, f"{base}?page=1", f"{base}?page=2"])

        debug_profile = os.path.join(APP_DIR, "chrome_debug_profile")
        os.makedirs(debug_profile, exist_ok=True)
        args = [
            chrome_exe,
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={debug_profile}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--disable-extensions",
            "--disable-component-update",
            "--disable-sync",
            "--disable-background-networking",
            "--disable-default-apps",
            "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication",
            f"--disk-cache-size={max(1, _as_int(cfg.get('chrome_disk_cache_size_mb'), 50)) * 1024 * 1024}",
            f"--media-cache-size={max(1, _as_int(cfg.get('chrome_media_cache_size_mb'), 1)) * 1024 * 1024}",
            "--aggressive-cache-discard",
            "--metrics-recording-only",
            "--no-report-upload",
            "--mute-audio",
            *urls,
        ]

        try:
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(0.8)
            return True
        except Exception as exc:
            print(f"[CDP] Chrome launch failed: {exc}")
            return False

    def get_chat_snapshot_light(self, limit=50):
        limit = max(10, min(50, _as_int(limit, 50)))
        js = r"""
        (function(){
            var limit = __LIMIT__;
            function visible(el) {
                if (!el || !el.getBoundingClientRect) return false;
                var rect = el.getBoundingClientRect();
                if (rect.width < 1 || rect.height < 1) return false;
                var style = window.getComputedStyle(el);
                return !!style && style.display !== 'none' && style.visibility !== 'hidden';
            }
            function text(el) {
                if (!el) return '';
                return String(el.innerText || el.textContent || '').trim();
            }
            function pick(root, selectors) {
                for (var i = 0; i < selectors.length; i++) {
                    var nodes = root.querySelectorAll(selectors[i]);
                    for (var j = 0; j < nodes.length; j++) {
                        if (visible(nodes[j])) return nodes[j];
                    }
                }
                return null;
            }
            function collectTextNodes(root, selectors) {
                var collected = [];
                for (var i = 0; i < selectors.length; i++) {
                    var nodes = root.querySelectorAll(selectors[i]);
                    for (var j = 0; j < nodes.length; j++) {
                        var node = nodes[j];
                        if (!visible(node)) continue;
                        if (collected.indexOf(node) < 0) collected.push(node);
                    }
                }
                return collected.filter(function(node) {
                    for (var k = 0; k < collected.length; k++) {
                        if (node !== collected[k] && node.contains(collected[k])) {
                            return false;
                        }
                    }
                    return true;
                });
            }
            function messageTextsFromNode(node) {
                var raw = text(node);
                if (!raw) return [];
                var parts = raw.split(/\n+/).map(function(part) {
                    return String(part || '').trim();
                }).filter(Boolean);
                return parts.length ? parts : [raw];
            }
            function stableNodeId(el, fallbackIndex) {
                var attrs = [
                    'data-message-id', 'data-messageid', 'data-msg-id', 'data-msgid',
                    'data-log-id', 'data-logid', 'data-chat-id', 'data-chatid',
                    'data-view-id', 'data-viewid'
                ];
                var direct = attrValue(el, attrs);
                if (direct) return 'attr:' + direct;
                if (typeof WeakMap === 'undefined') return 'idx:' + fallbackIndex;
                var ids = window.__dcAuctionChatNodeIds;
                if (!ids) {
                    ids = new WeakMap();
                    window.__dcAuctionChatNodeIds = ids;
                }
                var existing = ids.get(el);
                if (existing) return existing;
                var seq = (window.__dcAuctionChatNodeSeq || 0) + 1;
                window.__dcAuctionChatNodeSeq = seq;
                var nodeId = 'node:' + seq;
                ids.set(el, nodeId);
                return nodeId;
            }
            function attrValue(el, names) {
                if (!el || !el.getAttribute) return '';
                for (var i = 0; i < names.length; i++) {
                    var v = el.getAttribute(names[i]);
                    if (v && String(v).trim()) return String(v).trim();
                }
                return '';
            }
            function userKey(el, name) {
                var attrs = [
                    'data-user-id', 'data-userid', 'data-member-id', 'data-memberid',
                    'data-profile-id', 'data-profileid', 'data-user-no', 'data-userno',
                    'data-member-no', 'data-memberno', 'data-author-id', 'data-authorid'
                ];
                var node = el;
                while (node) {
                    var direct = attrValue(node, attrs);
                    if (direct) return direct;
                    var tagged = node.querySelector('[data-user-id],[data-userid],[data-member-id],[data-memberid],[data-profile-id],[data-profileid],[data-user-no],[data-userno],[data-member-no],[data-memberno],[data-author-id],[data-authorid]');
                    var nested = attrValue(tagged, attrs);
                    if (nested) return nested;
                    var link = node.querySelector('a[href*="memberNo="], a[href*="userNo="], a[href*="/profile/"], a[href*="/members/"]');
                    if (link) {
                        var href = (link.getAttribute('href') || '').trim();
                        var match = href.match(/(?:memberNo|userNo)=([^&#]+)/i) || href.match(/\/(?:profile|members)\/([^/?#]+)/i);
                        if (match && match[1]) return match[1];
                        if (href) return href;
                    }
                    node = node.parentElement;
                }
                return name || '';
            }

            var messageSelectors = [
                '[data-viewname="DLiveViewerChatMessageView"]',
                '.DLiveViewerChatMessageView',
                '[class*="ChatMessageView"]',
                '[class*="chatMessageView"]'
            ];
            var nameSelectors = [
                'em.mainText',
                '.writerInfo .mainText',
                '[class*="writerInfo"] [class*="mainText"]',
                '[class*="nickname"]',
                '[data-role="writer"]'
            ];
            var textSelectors = [
                'span.messageText',
                '[class*="messageText"]',
                '[class*="chatText"]',
                '[data-role="message"]'
            ];
            var timeSelectors = [
                'time.chatTime',
                'time',
                '[class*="chatTime"]',
                '[class*="messageTime"]'
            ];
            var inputSelectors = [
                '.writingArea._editor[contenteditable]',
                '.writingArea[contenteditable]',
                '[contenteditable="true"]._editor',
                '[contenteditable="plaintext-only"]._editor',
                '[contenteditable="true"][role="textbox"]',
                '[contenteditable="plaintext-only"][role="textbox"]',
                '[contenteditable="true"][aria-label*="메시지"]',
                '[contenteditable="true"][aria-label*="채팅"]',
                '[contenteditable="true"][data-placeholder*="메시지"]',
                '[contenteditable="true"][data-placeholder*="채팅"]'
            ];
            var sendSelectors = [
                'button._sendBtn',
                'button.btnSendMessage',
                'button[type="submit"]',
                'button[aria-label*="전송"]',
                'button[aria-label*="send"]'
            ];

            var selector = messageSelectors.join(',');
            var maxRoots = Math.max(limit * 2, 80);
            function messageRootFrom(node) {
                var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
                while (el && el !== document.body) {
                    if (el.matches && el.matches(selector)) return el;
                    el = el.parentElement;
                }
                return null;
            }
            function pruneRoots() {
                var roots = window.__dcAuctionChatRoots || [];
                var kept = [];
                for (var i = 0; i < roots.length; i++) {
                    var root = roots[i];
                    if (!root || !document.body.contains(root)) continue;
                    if (kept.indexOf(root) < 0) kept.push(root);
                }
                if (kept.length > maxRoots) kept = kept.slice(kept.length - maxRoots);
                window.__dcAuctionChatRoots = kept;
                return kept;
            }
            function seedRoots() {
                var initial = Array.prototype.slice.call(document.querySelectorAll(selector));
                window.__dcAuctionChatSeenCount = Math.max(window.__dcAuctionChatSeenCount || 0, initial.length);
                window.__dcAuctionChatRoots = initial.slice(Math.max(0, initial.length - maxRoots));
                window.__dcAuctionChatLastSeedAt = Date.now();
                return window.__dcAuctionChatRoots;
            }
            function rememberRoot(root, seq) {
                if (!root || !root.matches || !root.matches(selector)) return;
                var roots = window.__dcAuctionChatRoots || [];
                var existing = roots.indexOf(root);
                if (existing >= 0) {
                    return;
                } else {
                    roots.push(root);
                    window.__dcAuctionChatSeenCount = Math.max(window.__dcAuctionChatSeenCount || 0, roots.length);
                }
                if (roots.length > maxRoots) roots.splice(0, roots.length - maxRoots);
                window.__dcAuctionChatRoots = roots;
            }
            function ensureMutationTracker() {
                if (!window.__dcAuctionChatRoots) seedRoots();
                if (window.__dcAuctionChatMutationObserver) return;
                window.__dcAuctionChatMutationSeq = window.__dcAuctionChatMutationSeq || 0;
                window.__dcAuctionChatLastMutationAt = window.__dcAuctionChatLastMutationAt || Date.now();
                window.__dcAuctionChatMutationObserver = new MutationObserver(function(mutations) {
                    var seq = (window.__dcAuctionChatMutationSeq || 0) + 1;
                    window.__dcAuctionChatMutationSeq = seq;
                    window.__dcAuctionChatLastMutationAt = Date.now();
                    mutations.forEach(function(mutation) {
                        var root = messageRootFrom(mutation.target);
                        if (root) rememberRoot(root, seq);
                        Array.prototype.forEach.call(mutation.addedNodes || [], function(added) {
                            var addedRoot = messageRootFrom(added);
                            if (addedRoot) rememberRoot(addedRoot, seq);
                            if (added && added.querySelectorAll) {
                                Array.prototype.forEach.call(added.querySelectorAll(selector), function(childRoot) {
                                    rememberRoot(childRoot, seq);
                                });
                            }
                        });
                    });
                });
                window.__dcAuctionChatMutationObserver.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            }
            ensureMutationTracker();
            var roots = pruneRoots();
            if (!roots.length) roots = seedRoots();
            var now = Date.now();
            if ((now - (window.__dcAuctionChatLastSeedAt || 0)) > 5000) {
                roots = seedRoots();
            }
            var nodes = roots.slice(Math.max(0, roots.length - limit));
            var signatureParts = [String(window.__dcAuctionChatMutationSeq || 0), String(roots.length)];
            for (var s = Math.max(0, nodes.length - 5); s < nodes.length; s++) {
                signatureParts.push(text(nodes[s]).slice(-120));
            }
            var signature = signatureParts.join('|');
            var cache = window.__dcAuctionChatSnapshot || {};
            if (cache.signature === signature && cache.limit === limit && (Date.now() - cache.ts) < 500) {
                return JSON.stringify(cache.payload);
            }

            var messages = [];
            var start = Math.max(0, nodes.length - limit);
            for (var i = start; i < nodes.length; i++) {
                var el = nodes[i];
                if (!visible(el)) continue;
                var nameEl = pick(el, nameSelectors);
                if (!nameEl) continue;
                var name = text(nameEl);
                var timeEl = pick(el, timeSelectors);
                var msgNodes = collectTextNodes(el, textSelectors);
                var user = userKey(el, name);
                var nodeId = stableNodeId(el, i);
                var msgIndex = 0;
                for (var n = 0; n < msgNodes.length; n++) {
                    var parts = messageTextsFromNode(msgNodes[n]);
                    for (var p = 0; p < parts.length; p++) {
                        var msg = parts[p];
                        if (!name || !msg) continue;
                        messages.push({
                            name: name,
                            text: msg,
                            time: text(timeEl),
                            userKey: user,
                            messageKey: [nodeId, msgIndex, user, text(timeEl), msg].join(':')
                        });
                        msgIndex++;
                    }
                }
            }

            var input = pick(document, inputSelectors);
            var sendBtn = pick(document, sendSelectors);

            // ── DOM pruning: remove old chat nodes to prevent lag ──
            var pruneKeep = 60;
            var allDomMsgs = document.querySelectorAll(selector);
            if (allDomMsgs.length > pruneKeep + 30) {
                var removeCount = allDomMsgs.length - pruneKeep;
                for (var ri = 0; ri < removeCount; ri++) {
                    try { allDomMsgs[ri].remove(); } catch(e) {}
                }
                // rebuild tracked roots after pruning
                var fresh = Array.prototype.slice.call(document.querySelectorAll(selector));
                window.__dcAuctionChatRoots = fresh.slice(-pruneKeep);
                window.__dcAuctionChatSeenCount = Math.max(window.__dcAuctionChatSeenCount || 0, fresh.length);
            }

            var payload = {
                messages: messages.slice(-limit),
                messageNodeCount: window.__dcAuctionChatSeenCount || roots.length,
                mutationSeq: window.__dcAuctionChatMutationSeq || 0,
                inputFound: !!input,
                sendFound: !!sendBtn,
                domReady: !!input || nodes.length > 0
            };
            window.__dcAuctionChatSnapshot = {
                signature: signature,
                limit: limit,
                ts: Date.now(),
                payload: payload
            };
            return JSON.stringify(payload);
        })()
        """.replace("__LIMIT__", str(limit))

        try:
            raw = self.evaluate(js)
            return json.loads(raw) if raw else {
                "messages": [],
                "messageNodeCount": 0,
                "inputFound": False,
                "sendFound": False,
                "domReady": False,
            }
        except Exception as exc:
            print(f"[CDP] chat snapshot failed: {exc}")
            return {
                "messages": [],
                "messageNodeCount": 0,
                "inputFound": False,
                "sendFound": False,
                "domReady": False,
            }

    def get_chat_snapshot_ws(self, limit=50):
        """Return chat messages from WebSocket listener (near-zero CPU).
        Falls back to DOM-based method if WebSocket is not connected."""
        listener = getattr(self, "_ws_chat_listener", None)
        if listener and listener.is_alive():
            messages, mutation_seq = listener.get_messages()
            return {
                "messages": messages[-limit:] if messages else [],
                "messageNodeCount": listener._total_received,
                "mutationSeq": mutation_seq,
                "inputFound": True,
                "sendFound": True,
                "domReady": True,
            }
        # Fallback to DOM-based snapshot
        return get_chat_snapshot_light(self, limit)

    def _inject_chrome_optimizer(self):
        """Inject JS to pause video and reduce Chrome resource usage."""
        js = r"""
        (function() {
            // Pause all video elements
            var videos = document.querySelectorAll('video');
            for (var i = 0; i < videos.length; i++) {
                try {
                    videos[i].pause();
                    videos[i].removeAttribute('src');
                    videos[i].load();
                } catch(e) {}
            }
            // Stop HLS media source if any
            if (window.__dcVideoStopped) return 'already_stopped';
            window.__dcVideoStopped = true;
            // Remove video container to free memory
            var videoContainers = document.querySelectorAll(
                '[class*="videoArea"], [class*="playerArea"], [class*="livePlayer"]'
            );
            for (var j = 0; j < videoContainers.length; j++) {
                try {
                    videoContainers[j].style.display = 'none';
                } catch(e) {}
            }
            return 'optimized';
        })()
        """
        try:
            result = self.evaluate(js)
            if result:
                print(f"[CDP] Chrome optimizer: {result}", flush=True)
        except Exception as exc:
            print(f"[CDP] Chrome optimizer failed: {exc}", flush=True)

    def _start_ws_chat_listener(self):
        """Start the WebSocket chat listener."""
        if getattr(self, "_ws_chat_listener", None):
            return
        port = getattr(self, "port", 9222)
        listener = _BandChatWSListener(cdp_port=port)
        self._ws_chat_listener = listener
        listener.start()
        print(f"[WS Chat] Listener started on CDP port {port}", flush=True)

    BandCDP._launch_chrome = _launch_chrome_light
    BandCDP.send_message = send_message_as_separate_lines
    BandCDP.get_chat_snapshot_dom = get_chat_snapshot_light
    BandCDP.get_chat_snapshot = get_chat_snapshot_ws
    BandCDP._inject_chrome_optimizer = _inject_chrome_optimizer
    BandCDP._start_ws_chat_listener = _start_ws_chat_listener


def _patch_settings_dialog():
    class SettingsDialog(_core.QDialog):
        def __init__(self, config, parent=None):
            super().__init__(parent)
            self.config = config
            self.setWindowTitle("설정")
            self.setMinimumWidth(620)
            self.resize(700, 720)
            self.setStyleSheet("""
                QDialog { background: #F2F4F6; }
                QLabel { background: transparent; }
                QLineEdit, QComboBox {
                    padding: 9px 11px; font-size: 13px; background: #FFFFFF; color: #111111;
                    border: 1px solid #DDE1E6; border-radius: 6px; min-height: 34px;
                }
                QLineEdit:focus, QComboBox:focus { border: 1px solid #3182F6; }
                QCheckBox { font-size: 13px; font-weight: 700; color: #111111; spacing: 8px; padding: 4px 0; }
                QCheckBox::indicator { width: 18px; height: 18px; border-radius: 4px; border: 2px solid #D5D6DC; background: #FFFFFF; }
                QCheckBox::indicator:checked { background: #3182F6; border-color: #3182F6; }
            """)

            outer = _core.QVBoxLayout(self)
            outer.setContentsMargins(0, 0, 0, 0)
            outer.setSpacing(0)

            header = _core.QWidget()
            header.setFixedHeight(56)
            header.setStyleSheet("background: #093687;")
            h_lay = _core.QHBoxLayout(header)
            h_lay.setContentsMargins(24, 0, 16, 0)
            h_title = _core.QLabel("설정")
            h_title.setStyleSheet("color: #FFFFFF; font-size: 18px; font-weight: 800;")
            h_lay.addWidget(h_title)
            h_lay.addStretch()
            outer.addWidget(header)

            scroll = _core.QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(_core.QScrollArea.NoFrame)
            scroll.setStyleSheet("QScrollArea { background: #F2F4F6; border: none; }")
            content = _core.QWidget()
            layout = _core.QVBoxLayout(content)
            layout.setContentsMargins(20, 20, 20, 20)
            layout.setSpacing(12)

            sheet_sec = self._section("구글 시트")
            layout.addWidget(sheet_sec["card"])
            self.sheet_url = self._line(config.get("sheet_url", ""))
            self.api_key = self._line(config.get("api_key", ""))
            self.api_key.setEchoMode(_core.QLineEdit.Password)
            self.sa_path = self._line(config.get("service_account_json", ""))
            sheet_sec["layout"].addWidget(self._label("스프레드시트 URL"))
            sheet_sec["layout"].addWidget(self.sheet_url)
            sheet_sec["layout"].addWidget(self._label("API 키"))
            sheet_sec["layout"].addWidget(self.api_key)
            sheet_sec["layout"].addWidget(self._label("서비스 계정 JSON"))
            sa_row = _core.QHBoxLayout()
            sa_row.setSpacing(6)
            btn_browse = self._button("찾기")
            btn_browse.setFixedWidth(72)
            btn_browse.clicked.connect(self._browse_sa)
            sa_row.addWidget(self.sa_path, 1)
            sa_row.addWidget(btn_browse)
            sheet_sec["layout"].addLayout(sa_row)
            btn_test = self._button("연결 테스트")
            btn_test.clicked.connect(self._test_connection)
            sheet_sec["layout"].addWidget(btn_test)
            self.lbl_test = _core.QLabel("")
            self.lbl_test.setWordWrap(True)
            self.lbl_test.setStyleSheet("font-size: 12px; color: #6B7280; font-weight: 600;")
            sheet_sec["layout"].addWidget(self.lbl_test)

            chrome_sec = self._section("Chrome / Band")
            layout.addWidget(chrome_sec["card"])
            self.chrome_port = self._line(str(config.get("chrome_port", 9222)))
            self.chrome_disk_cache = self._line(str(config.get("chrome_disk_cache_size_mb", 50)))
            self.chrome_media_cache = self._line(str(config.get("chrome_media_cache_size_mb", 1)))
            self.chk_aux_pages = _core.QCheckBox("Chrome 시작 시 시트/방송 보조 페이지도 함께 열기")
            self.chk_aux_pages.setChecked(_as_bool(config.get("chrome_open_aux_pages"), False))
            for label, widget in [
                ("원격 디버깅 포트", self.chrome_port),
                ("디스크 캐시 제한(MB)", self.chrome_disk_cache),
                ("미디어 캐시 제한(MB)", self.chrome_media_cache),
            ]:
                chrome_sec["layout"].addWidget(self._label(label))
                chrome_sec["layout"].addWidget(widget)
            chrome_sec["layout"].addWidget(self.chk_aux_pages)

            msg_sec = self._section("경매 문구")
            layout.addWidget(msg_sec["card"])
            self.chk_auto_chat = _core.QCheckBox("경매 이벤트 채팅 자동 전송")
            self.chk_auto_chat.setChecked(_as_bool(config.get("auto_chat_enabled"), True))
            msg_sec["layout"].addWidget(self.chk_auto_chat)
            tmpls = config.get("templates", {}) or {}
            self.tpl_start = self._line(tmpls.get("start", ""))
            sold_tpl = tmpls.get("sold", "")
            if not sold_tpl or sold_tpl.strip() in {
                "{name} 낙찰! {sold_price}만 ({winner})",
                r"🦖 {name} 낙찰\n👤 {winner}\n💰 {sold_price}만원",
                r"┃ {name} 낙찰\n┃ 낙찰자 {winner}\n┃ 낙찰금 {sold_price}만원",
                r"🟢 {name} 낙찰\n🟢 {sold_price}만원 {winner}",
                r"🟢{name} 낙찰\nㅤ {sold_price}만원 {winner}",
                r"⠀⠀🟢{name} 낙찰\n⠀⠀ㅤ {sold_price}만원 {winner}",
            }:
                sold_tpl = r"⠀⠀🟢 낙찰 {name}\n⠀⠀ㅤ  {sold_price}만원 {winner}"
            self.tpl_sold = self._line(sold_tpl)
            self.tpl_unsold = self._line(tmpls.get("unsold", ""))
            highest_tpl = tmpls.get("highest", "")
            if not highest_tpl or highest_tpl.strip() in {
                "현재 최고가 {sold_price}만 ({winner})",
                r"🔴 실시간 입찰\n💰 현재 최고가 {sold_price}만원\n👤 {winner}",
                r"┃ 실시간 입찰\n┃ 현재 최고가 {sold_price}만원\n┃ 입찰자 {winner}",
                "■⠀ {sold_price}만원 {winner}⠀ ■",
                "🔺 {sold_price}만원 {winner}",
                "🔴 {sold_price}만원 {winner}",
                "⠀⠀🔴 {sold_price}만원 {winner}",
            }:
                highest_tpl = "⠀⠀🔴 입찰 {sold_price}만원 {winner}⠀⠀"
            self.tpl_highest = self._line(highest_tpl)
            for label, widget in [
                ("경매 시작", self.tpl_start),
                ("낙찰", self.tpl_sold),
                ("유찰", self.tpl_unsold),
                ("현재 최고가", self.tpl_highest),
            ]:
                msg_sec["layout"].addWidget(self._label(label))
                msg_sec["layout"].addWidget(widget)
            hint = _core.QLabel("사용 가능 값: {num}, {name}, {price}, {sold_price}, {winner}  |  줄바꿈: \\n")
            hint.setWordWrap(True)
            hint.setStyleSheet("font-size: 12px; color: #6B7280; padding: 6px 0;")
            msg_sec["layout"].addWidget(hint)

            motion_sec = self._section("방송 연출")
            layout.addWidget(motion_sec["card"])
            self.chk_auction_animation = _core.QCheckBox("낙찰 애니메이션")
            self.chk_auction_animation.setChecked(_as_bool(config.get("auction_animation_enabled"), True))
            motion_sec["layout"].addWidget(self.chk_auction_animation)
            motion_hint = _core.QLabel(
                "ON: 낙찰 시 마스킹된 낙찰자와 금액을 잠시 표시하고, 후공 종료 후 라운드 승패를 연출합니다."
            )
            motion_hint.setWordWrap(True)
            motion_hint.setStyleSheet("font-size: 12px; color: #6B7280; line-height: 1.45; border: none;")
            motion_sec["layout"].addWidget(motion_hint)

            printer_sec = self._section("라벨 프린터")
            layout.addWidget(printer_sec["card"])
            self.chk_auto_label_print = _core.QCheckBox("낙찰 시 라벨 자동 출력")
            self.chk_auto_label_print.setChecked(_as_bool(config.get("auto_label_print_enabled"), True))
            printer_sec["layout"].addWidget(self.chk_auto_label_print)
            self.cmb_font = _core.QComboBox()
            try:
                from niimbot_printer import get_available_font_list
                font_list = get_available_font_list()
            except Exception:
                font_list = [("pretendard", "Pretendard")]
            current_font_key = config.get("label_font", "pretendard")
            selected_index = 0
            for idx, (key, display) in enumerate(font_list):
                self.cmb_font.addItem(display, key)
                if key == current_font_key:
                    selected_index = idx
            self.cmb_font.setCurrentIndex(selected_index)
            self.cmb_label_layout = _core.QComboBox()
            label_layouts = [
                ("경매용", "auction"),
                ("개체명 / 이름·지역 / 번호", "contact"),
            ]
            current_label_layout = config.get("label_layout", "auction")
            layout_selected_index = 0
            for idx, (display, key) in enumerate(label_layouts):
                self.cmb_label_layout.addItem(display, key)
                if key == current_label_layout:
                    layout_selected_index = idx
            self.cmb_label_layout.setCurrentIndex(layout_selected_index)
            self.label_timeout = self._line(str(config.get("label_print_timeout_sec", 35)))
            self.label_retries = self._line(str(config.get("label_print_retries", 1)))
            self.label_scan_timeout = self._line(str(config.get("label_ble_scan_timeout", 1.0)))
            for label, widget in [
                ("라벨 형식", self.cmb_label_layout),
                ("폰트", self.cmb_font),
                ("출력 제한 시간(초)", self.label_timeout),
                ("실패 재시도 횟수", self.label_retries),
                ("BLE 검색 제한 시간(초)", self.label_scan_timeout),
            ]:
                printer_sec["layout"].addWidget(self._label(label))
                printer_sec["layout"].addWidget(widget)

            capture_sec = self._section("낙찰 자동 캡처")
            layout.addWidget(capture_sec["card"])
            self.chk_auto_capture = _core.QCheckBox("낙찰 완료 시 본체 PRISM 화면 자동 캡처")
            self.chk_auto_capture.setChecked(_as_bool(config.get("auto_capture_enabled"), False))
            self.capture_service_url = self._line(config.get("capture_service_url", "https://creok.onrender.com"))
            self.capture_channel_id = self._line(config.get("capture_channel_id", "auto"))
            self.capture_agent_token = self._line(config.get("capture_agent_token", ""))
            self.capture_agent_token.setEchoMode(_core.QLineEdit.Password)
            self.platform_admin_password = self._line(config.get("platform_admin_password", ""))
            self.platform_admin_password.setEchoMode(_core.QLineEdit.Password)
            capture_sec["layout"].addWidget(self.chk_auto_capture)
            for label, widget in [
                ("CREO 서버 주소", self.capture_service_url),
                ("경매 채널 (auto = 현재 활성)", self.capture_channel_id),
                ("캡처 토큰 또는 관리자 비밀번호", self.capture_agent_token),
                ("채널 운영 관리자 비밀번호", self.platform_admin_password),
            ]:
                capture_sec["layout"].addWidget(self._label(label))
                capture_sec["layout"].addWidget(widget)
            capture_test = self._button("캡처 서버 연결 테스트")
            capture_test.clicked.connect(self._test_capture_connection)
            capture_sec["layout"].addWidget(capture_test)
            self.lbl_capture_test = _core.QLabel("")
            self.lbl_capture_test.setWordWrap(True)
            self.lbl_capture_test.setStyleSheet("font-size:12px; color:#6B7280; font-weight:600; border:none;")
            capture_sec["layout"].addWidget(self.lbl_capture_test)

            layout.addStretch()
            scroll.setWidget(content)
            outer.addWidget(scroll, 1)

            bottom = _core.QWidget()
            bottom.setStyleSheet("background: #FFFFFF; border-top: 1px solid #EAECEE;")
            b_lay = _core.QHBoxLayout(bottom)
            b_lay.setContentsMargins(20, 12, 20, 12)
            btn_cancel = self._button("취소")
            btn_cancel.clicked.connect(self.reject)
            btn_save = self._button("저장")
            btn_save.setStyleSheet("""
                QPushButton { background: #093687; color: #FFFFFF; border: none;
                border-radius: 6px; padding: 10px 28px; font-size: 14px; font-weight: 800; min-height: 40px; }
                QPushButton:hover { background: #072C6F; }
            """)
            btn_save.clicked.connect(self._save)
            b_lay.addWidget(btn_cancel)
            b_lay.addStretch()
            b_lay.addWidget(btn_save)
            outer.addWidget(bottom)

        def _line(self, text=""):
            return _core.QLineEdit(str(text or ""))

        def _section(self, title_text):
            card = _core.QWidget()
            card.setStyleSheet("QWidget { background: #FFFFFF; border-radius: 8px; border: 1px solid #EAECEE; }")
            card_l = _core.QVBoxLayout(card)
            card_l.setContentsMargins(18, 16, 18, 18)
            card_l.setSpacing(8)
            title = _core.QLabel(title_text)
            title.setStyleSheet("color: #111111; font-size: 14px; font-weight: 800; border: none;")
            card_l.addWidget(title)
            sep = _core.QWidget()
            sep.setFixedHeight(1)
            sep.setStyleSheet("background: #F0F0F0; border: none;")
            card_l.addWidget(sep)
            return {"card": card, "layout": card_l}

        def _label(self, text):
            lbl = _core.QLabel(text)
            lbl.setStyleSheet("color: #4E5968; font-size: 12px; font-weight: 700; margin-top: 4px; border: none;")
            return lbl

        def _button(self, text):
            btn = _core.QPushButton(text)
            btn.setStyleSheet("""
                QPushButton { background: #FFFFFF; color: #333333; border: 1px solid #DDE1E6;
                border-radius: 6px; padding: 9px 14px; font-size: 13px; font-weight: 700; min-height: 36px; }
                QPushButton:hover { background: #F7F8FA; border-color: #C9D1DA; }
            """)
            return btn

        def _browse_sa(self):
            path, _ = _core.QFileDialog.getOpenFileName(self, "서비스 계정 JSON", APP_DIR, "JSON (*.json)")
            if path:
                try:
                    rel = os.path.relpath(path, APP_DIR)
                    if not rel.startswith(".."):
                        path = rel
                except Exception:
                    pass
                self.sa_path.setText(path)

        def _test_connection(self):
            self.lbl_test.setText("연결 테스트 중...")
            self.lbl_test.setStyleSheet("font-size:12px; color:#8A6D00; font-weight:700;")
            _core.QApplication.processEvents()
            results = []
            url = self.sheet_url.text().strip()
            key = self.api_key.text().strip()
            sid = ""
            if url and key:
                try:
                    import re as _re
                    import requests as _requests
                    match = _re.search(r"/d/([a-zA-Z0-9_-]+)", url)
                    if match:
                        sid = match.group(1)
                        response = _requests.get(
                            f"https://sheets.googleapis.com/v4/spreadsheets/{sid}?key={key}",
                            timeout=5,
                        )
                        if response.status_code == 200:
                            results.append("OK: 시트 API 읽기 연결 성공")
                        else:
                            results.append(f"ERR: 시트 API 실패 ({response.status_code})")
                    else:
                        results.append("ERR: 시트 URL에서 문서 ID를 찾을 수 없습니다")
                except Exception as exc:
                    results.append(f"ERR: 시트 읽기 테스트 실패 ({exc})")
            else:
                results.append("ERR: 시트 URL / API 키가 비어 있습니다")

            sa = _core.resolve_app_path(self.sa_path.text().strip())
            if sa and os.path.exists(sa):
                if sid:
                    try:
                        import gspread
                        from google.oauth2.service_account import Credentials
                        scopes = [
                            "https://www.googleapis.com/auth/spreadsheets",
                            "https://www.googleapis.com/auth/drive",
                        ]
                        creds = Credentials.from_service_account_file(sa, scopes=scopes)
                        gc = gspread.authorize(creds)
                        ss = gc.open_by_key(sid)
                        tab = self.config.get("sheet_tab", "")
                        if tab:
                            ss.worksheet(tab)
                            results.append(f"OK: 서비스 계정 쓰기 연결 성공 ({tab})")
                        else:
                            results.append("OK: 서비스 계정 쓰기 연결 성공")
                    except Exception as exc:
                        results.append(f"ERR: 서비스 계정 쓰기 테스트 실패 ({exc})")
                else:
                    results.append("OK: 서비스 계정 파일 확인")
            elif sa:
                results.append("ERR: 서비스 계정 파일이 없습니다")

            ok = bool(results) and all(line.startswith("OK:") for line in results)
            color = "#1F7A3A" if ok else "#B45309"
            self.lbl_test.setText("\n".join(results))
            self.lbl_test.setStyleSheet(f"font-size:12px; color:{color}; font-weight:700;")

        def _test_capture_connection(self):
            self.lbl_capture_test.setText("연결 확인 중...")
            _core.QApplication.processEvents()
            try:
                result = CaptureClient(
                    self.capture_service_url.text(),
                    self.capture_agent_token.text(),
                    self.capture_channel_id.text() or "auto",
                ).check()
                storage = (result.get("storage") or {}).get("backend", "-")
                self.lbl_capture_test.setText(f"연결 성공 · 이미지 저장소 {storage}")
                self.lbl_capture_test.setStyleSheet("font-size:12px; color:#1F7A3A; font-weight:700; border:none;")
            except Exception as exc:
                self.lbl_capture_test.setText(f"연결 실패 · {exc}")
                self.lbl_capture_test.setStyleSheet("font-size:12px; color:#B45309; font-weight:700; border:none;")

        def _int_field(self, widget, key, min_value=0):
            value = int(str(widget.text()).strip())
            if value < min_value:
                raise ValueError(f"{key} below minimum")
            return value

        def _float_field(self, widget, key, min_value=0.0):
            value = float(str(widget.text()).strip())
            if value < min_value:
                raise ValueError(f"{key} below minimum")
            return value

        def _save(self):
            try:
                self.config["sheet_url"] = self.sheet_url.text().strip()
                self.config["api_key"] = self.api_key.text().strip()
                self.config["service_account_json"] = self.sa_path.text().strip()
                self.config["chrome_port"] = self._int_field(self.chrome_port, "Chrome 포트", 1)
                self.config["chrome_disk_cache_size_mb"] = self._int_field(self.chrome_disk_cache, "디스크 캐시", 1)
                self.config["chrome_media_cache_size_mb"] = self._int_field(self.chrome_media_cache, "미디어 캐시", 1)
                self.config["chrome_open_aux_pages"] = self.chk_aux_pages.isChecked()
                self.config["auto_chat_enabled"] = self.chk_auto_chat.isChecked()
                self.config["auction_animation_enabled"] = self.chk_auction_animation.isChecked()
                self.config["auto_label_print_enabled"] = self.chk_auto_label_print.isChecked()
                self.config["auto_capture_enabled"] = self.chk_auto_capture.isChecked()
                self.config["capture_service_url"] = self.capture_service_url.text().strip().rstrip("/")
                self.config["capture_channel_id"] = self.capture_channel_id.text().strip()
                self.config["capture_agent_token"] = self.capture_agent_token.text().strip()
                self.config["platform_admin_password"] = self.platform_admin_password.text().strip()
                self.config["templates"] = {
                    "start": self.tpl_start.text(),
                    "sold": self.tpl_sold.text(),
                    "unsold": self.tpl_unsold.text(),
                    "highest": self.tpl_highest.text(),
                }
                self.config["label_font"] = self.cmb_font.currentData() or "pretendard"
                self.config["label_layout"] = self.cmb_label_layout.currentData() or "auction"
                self.config["label_print_timeout_sec"] = self._int_field(self.label_timeout, "출력 제한 시간", 5)
                self.config["label_print_retries"] = self._int_field(self.label_retries, "실패 재시도 횟수", 0)
                self.config["label_ble_scan_timeout"] = self._float_field(self.label_scan_timeout, "BLE 검색 제한 시간", 0.0)
                _core.save_config(self.config)
                self.accept()
            except Exception as exc:
                _core.QMessageBox.warning(self, "설정값 오류", f"숫자 설정값을 확인해주세요.\n{exc}")

    def _open_settings_safe(self):
        try:
            dlg = _core.SettingsDialog(self.config, self)
            if dlg.exec_() == _core.QDialog.Accepted:
                saved_active = getattr(self, "active_item", None)
                saved_start_time = getattr(self, "auction_start_time", None)
                saved_bids = saved_active.get("bids", [])[:] if saved_active else None
                self.config = _core.load_config()
                self.sheets = _create_data_manager(self.config)
                self.sheets_manager = self.sheets
                _sync_auction_animation_config(self.config, self.sheets)
                self.cdp = _core.BandCDP(self.config.get("chrome_port", 9222))
                self.active_item = saved_active
                self.auction_start_time = saved_start_time
                if saved_active and saved_bids is not None:
                    saved_active["bids"] = saved_bids
                if hasattr(self, "_update_chat_mute_indicator"):
                    self._update_chat_mute_indicator()
                if hasattr(self, "_update_auto_label_print_indicator"):
                    self._update_auto_label_print_indicator()
                _core.QTimer.singleShot(300, self._connect_all)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            try:
                _core.QMessageBox.critical(self, "설정 오류", f"설정창을 열 수 없습니다.\n{exc}")
            except Exception:
                print(f"[Settings] open failed: {exc}")

    _core.SettingsDialog = SettingsDialog
    _core.MainWindow._open_settings = _open_settings_safe


def _patch_auction_card_performance():
    AuctionCardWidget = _core.AuctionCardWidget
    original_init = AuctionCardWidget.__init__

    def _amount_text(amount):
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            return str(amount or "")
        if amount == int(amount):
            return str(int(amount))
        return str(amount).rstrip("0").rstrip(".")

    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        table = getattr(self, "bid_table", None)
        if table is None:
            return

        table.setEditTriggers(
            _core.QAbstractItemView.DoubleClicked
            | _core.QAbstractItemView.SelectedClicked
            | _core.QAbstractItemView.EditKeyPressed
            | _core.QAbstractItemView.AnyKeyPressed
        )
        table.setSelectionBehavior(_core.QAbstractItemView.SelectRows)

        parent = table.parentWidget()
        layout = parent.layout() if parent is not None else None
        if layout is None or getattr(self, "_manual_bid_controls_installed", False):
            return

        row = _core.QHBoxLayout()
        row.setSpacing(4)
        button_style = (
            "QPushButton { background:#F7F8FA; color:#333333; border:1px solid #D5D6DC; "
            "border-radius:4px; padding:4px 6px; font-size:11px; font-weight:700; min-height:24px; }"
            "QPushButton:hover { background:#EEF2FF; border-color:#9DB5FF; }"
            "QPushButton:disabled { color:#B0B8C1; background:#F7F8FA; border-color:#E5E8EB; }"
        )
        self.btn_manual_bid_add = _core.QPushButton("입찰 추가")
        self.btn_manual_bid_edit = _core.QPushButton("선택 수정")
        self.btn_manual_bid_delete = _core.QPushButton("선택 삭제")
        for button in (self.btn_manual_bid_add, self.btn_manual_bid_edit, self.btn_manual_bid_delete):
            button.setStyleSheet(button_style)
            button.setCursor(_core.Qt.PointingHandCursor)
            row.addWidget(button)
        self.btn_manual_bid_add.clicked.connect(lambda: _manual_add_bid(self))
        self.btn_manual_bid_edit.clicked.connect(lambda: _manual_edit_selected_bid(self))
        self.btn_manual_bid_delete.clicked.connect(lambda: _manual_delete_selected_bid(self))

        action_layout = None
        container = self.findChild(_core.QWidget, "auctionCard")
        container_layout = container.layout() if container is not None else None
        if container_layout is not None:
            for layout_index in range(container_layout.count()):
                candidate = container_layout.itemAt(layout_index).layout()
                if candidate is not None and candidate.indexOf(getattr(self, "btn_sold", None)) >= 0:
                    action_layout = candidate
                    break
        if action_layout is not None and not hasattr(self, "btn_countdown"):
            self.btn_countdown = _core.QPushButton("마감 카운트")
            self.btn_countdown.setObjectName("btnCountdown")
            self.btn_countdown.setCursor(_core.Qt.PointingHandCursor)
            sold_index = action_layout.indexOf(self.btn_sold)
            action_layout.insertWidget(max(0, sold_index + 1), self.btn_countdown)
            self.btn_countdown.clicked.connect(
                lambda _checked=False, card=self: _dispatch_countdown_action(card)
            )

        index = layout.indexOf(table)
        if index >= 0:
            layout.insertLayout(index, row)
        else:
            layout.addLayout(row)
        self._manual_bid_controls_installed = True

    def _manual_bid_window(self):
        win = self.window()
        if not win or win is self or not getattr(win, "active_item", None):
            if win and hasattr(win, "toast"):
                win.toast.show_toast("진행 중인 경매가 없습니다.", "warning")
            return None
        return win

    def _manual_add_bid(self):
        win = _manual_bid_window(self)
        if not win:
            return
        result = win._prompt_manual_bid("입찰 추가")
        if not result:
            return
        name, amount = result
        win._record_manual_bid(name, amount, force_top=False)

    def _manual_edit_selected_bid(self):
        win = _manual_bid_window(self)
        if not win:
            return
        row = self.bid_table.currentRow()
        bids = win._normalize_bid_entries(win.active_item.get("bids", []))
        if row < 0 or row >= len(bids):
            win.toast.show_toast("수정할 입찰자를 선택해주세요.", "warning")
            return
        bid = bids[row]
        result = win._prompt_manual_bid(
            "입찰 수정",
            default_name=str(bid.get("name", "")),
            default_amount=_amount_text(bid.get("amount", "")),
        )
        if not result:
            return
        del bids[row]
        win.active_item["bids"] = bids
        name, amount = result
        win._record_manual_bid(name, amount, force_top=False)

    def _manual_delete_selected_bid(self):
        win = _manual_bid_window(self)
        if not win:
            return
        is_quiz = _quiz_item_meta(win.active_item).get("is_quiz", False)
        row = 0 if is_quiz else self.bid_table.currentRow()
        bids = win._normalize_bid_entries(win.active_item.get("bids", []))
        if row < 0 or row >= len(bids):
            message = "취소할 정답자가 없습니다." if is_quiz else "삭제할 입찰자를 선택해주세요."
            win.toast.show_toast(message, "warning")
            return
        del bids[row]
        win.active_item["bids"] = bids
        win._persist_bid_state_async(win.active_item, bids)
        self.update_bids(bids)
        if is_quiz:
            win.toast.show_toast("정답자를 취소했습니다. 다시 정답을 받을 수 있습니다.", "success")

    def update_bids_fast(self, bids):
        bids = list(bids or [])
        display_bids = bids[:MAX_BID_TABLE_ROWS]
        current_item = getattr(self, "_viewing_item", None)
        if not current_item:
            current_item = getattr(self.window(), "active_item", None)
        is_quiz = _quiz_item_meta(current_item).get("is_quiz", False)
        table = getattr(self, "bid_table", None)
        self._updating_bids = True
        old_block = None
        if table is not None:
            old_block = table.blockSignals(True)
            table.setUpdatesEnabled(False)

        try:
            if table is not None:
                table.setRowCount(len(display_bids))
            if bids:
                self.lbl_highest.setVisible(True)
                self.lbl_winner.setVisible(True)
                self.lbl_bid_count.setVisible(True)
                count_text = f"정답 {len(bids)}명" if is_quiz else f"입찰 {len(bids)}건"
                if len(bids) > len(display_bids):
                    count_text += f" / 상위 {len(display_bids)}건 표시"
                self.lbl_bid_count.setText(count_text)
            else:
                self.lbl_bid_count.setText("")
                self.lbl_highest.setText("")
                self.lbl_winner.setText("")
                self.lbl_bid_count.setVisible(False)
                self.lbl_highest.setVisible(False)
                self.lbl_winner.setVisible(False)
                return

            top = bids[0]
            self.lbl_highest.setText("정답!" if is_quiz else _core.fmt_price(top.get("amount", 0)))
            self.lbl_highest.setStyleSheet(
                "font-size:40px; font-weight:900; color:#D64B32;"
                if is_quiz else
                "font-size:40px; font-weight:900; color:#191F28;"
            )
            self.lbl_winner.setText(str(top.get("name", "")))

            if table is None:
                return

            bold_font = _core.QFont()
            bold_font.setBold(True)
            for i, bid in enumerate(display_bids):
                price_item = _core.QTableWidgetItem(
                    "정답!" if is_quiz else _core.fmt_price(bid.get("amount", 0))
                )
                name_item = _core.QTableWidgetItem(str(bid.get("name", "")))
                time_item = _core.QTableWidgetItem(str(bid.get("time", "")))

                price_item.setTextAlignment(_core.Qt.AlignRight | _core.Qt.AlignVCenter)
                name_item.setTextAlignment(_core.Qt.AlignLeft | _core.Qt.AlignVCenter)
                time_item.setTextAlignment(_core.Qt.AlignRight | _core.Qt.AlignVCenter)

                if i == 0:
                    for item in (price_item, name_item, time_item):
                        item.setForeground(_core.QColor("#C84A31"))
                        item.setFont(bold_font)
                else:
                    for item in (price_item, name_item, time_item):
                        item.setForeground(_core.QColor("#6B7280"))
                    name_item.setForeground(_core.QColor("#333333"))

                table.setItem(i, 0, price_item)
                table.setItem(i, 1, name_item)
                table.setItem(i, 2, time_item)
        finally:
            if table is not None:
                if old_block is not None:
                    table.blockSignals(old_block)
                table.setUpdatesEnabled(True)
                viewport = table.viewport()
                if viewport is not None:
                    viewport.update()
            self._updating_bids = False

    AuctionCardWidget.__init__ = __init__
    AuctionCardWidget.update_bids = update_bids_fast


def _patch_auction_card_quick_edit():
    AuctionCardWidget = _core.AuctionCardWidget
    original_init = AuctionCardWidget.__init__
    original_show_item_detail = AuctionCardWidget.show_item_detail
    original_set_active = AuctionCardWidget.set_active

    class QuickEditBridge(_core.QObject):
        sig_done = _core.pyqtSignal(bool, str, object)

    def _parse_checklist(raw):
        values = {}
        for part in str(raw or "").split("|"):
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            values[key.strip()] = value.strip()
        return values

    def _update_checklist(raw, gender, weight):
        preserved = []
        for part in str(raw or "").split("|"):
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            key = key.strip()
            if key in {"gender", "weight"}:
                continue
            preserved.append(f"{key}:{value.strip()}")
        quick = []
        if gender:
            quick.append(f"gender:{gender}")
        if weight:
            quick.append(f"weight:{weight}")
        return "|".join(quick + preserved)

    def _ensure_quick_bridge(self):
        if getattr(self, "_quick_edit_bridge", None) is None:
            self._quick_edit_bridge = QuickEditBridge(self)
            self._quick_edit_bridge.sig_done.connect(
                lambda ok, error, item: _on_quick_save_done(self, ok, error, item)
            )
        if getattr(self, "_quick_autosave_timer", None) is None:
            self._quick_autosave_timer = _core.QTimer(self)
            self._quick_autosave_timer.setSingleShot(True)
            self._quick_autosave_timer.timeout.connect(lambda: _save_quick_item(self))
            self._quick_save_inflight = False
            self._quick_save_pending = False

    def _schedule_quick_save(self, delay=650):
        if getattr(self, "_quick_edit_item", None) is None:
            return
        _ensure_quick_bridge(self)
        self._quick_autosave_timer.start(max(0, int(delay)))

    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        _ensure_quick_bridge(self)

    def _update_detail_grid(self, item):
        pending_timer = getattr(self, "_quick_autosave_timer", None)
        if pending_timer is not None and pending_timer.isActive() and getattr(self, "_quick_edit_item", None):
            pending_timer.stop()
            _save_quick_item(self)

        grid = self.detail_grid_layout
        while grid.count():
            child = grid.takeAt(0)
            widget = child.widget()
            if widget is not None:
                widget.deleteLater()

        if not item:
            self.detail_grid_widget.setVisible(False)
            self._quick_edit_item = None
            return

        _ensure_quick_bridge(self)
        self._quick_edit_item = item
        checklist = _parse_checklist(item.get("checklist", ""))

        name_label = _core.QLabel("개체명")
        name_label.setStyleSheet("font-size:13px; color:#475467; font-weight:800;")
        name_label.setFixedWidth(68)
        name = _core.QLineEdit(str(item.get("name") or ""))
        name.setPlaceholderText("개체명을 입력하세요")
        name.setFixedHeight(42)

        gender_label = _core.QLabel("성별")
        gender_label.setStyleSheet("font-size:13px; color:#475467; font-weight:800;")
        gender_label.setFixedWidth(68)
        gender = _core.QComboBox()
        gender.addItem("미구분", "U")
        gender.addItem("수컷", "M")
        gender.addItem("암컷", "F")
        gender.setCurrentIndex(max(0, gender.findData(checklist.get("gender") or "U")))
        gender.setToolTip("클릭하거나 마우스 휠로 성별 변경")
        gender.setFixedHeight(42)

        weight_label = _core.QLabel("무게(g)")
        weight_label.setStyleSheet("font-size:13px; color:#475467; font-weight:800;")
        weight_label.setFixedWidth(68)
        weight = _core.QLineEdit(checklist.get("weight", ""))
        weight.setPlaceholderText("예: 3.1")
        weight.setAlignment(_core.Qt.AlignRight | _core.Qt.AlignVCenter)
        weight.setFixedHeight(42)

        note = _core.QLineEdit(str(item.get("note") or ""))
        note.setPlaceholderText("비고를 입력하세요")
        note.setFixedHeight(42)

        note_label = _core.QLabel("비고")
        note_label.setStyleSheet("font-size:13px; color:#475467; font-weight:800;")
        note_label.setFixedWidth(68)

        input_style = (
            "QLineEdit, QComboBox { background:#FFFFFF; border:1px solid #D9DDE3; "
            "border-radius:7px; padding:7px 10px; font-size:14px; font-weight:700; color:#191F28; }"
            "QLineEdit:focus, QComboBox:focus { border-color:#4772D9; }"
        )
        name.setStyleSheet(input_style)
        gender.setStyleSheet(input_style)
        weight.setStyleSheet(input_style)
        note.setStyleSheet(input_style)
        grid.setContentsMargins(14, 12, 14, 12)
        grid.setHorizontalSpacing(10)
        grid.setVerticalSpacing(8)
        grid.addWidget(name_label, 0, 0)
        grid.addWidget(name, 0, 1)
        grid.addWidget(gender_label, 1, 0)
        grid.addWidget(gender, 1, 1)
        grid.addWidget(weight_label, 2, 0)
        grid.addWidget(weight, 2, 1)
        grid.addWidget(note_label, 3, 0)
        grid.addWidget(note, 3, 1)
        grid.setColumnStretch(0, 0)
        grid.setColumnStretch(1, 1)

        self._quick_name = name
        self._quick_gender = gender
        self._quick_weight = weight
        self._quick_note = note
        self._quick_save_button = None
        name.textEdited.connect(lambda: _schedule_quick_save(self, 700))
        gender.currentIndexChanged.connect(lambda: _schedule_quick_save(self, 250))
        weight.textEdited.connect(lambda: _schedule_quick_save(self, 700))
        note.textEdited.connect(lambda: _schedule_quick_save(self, 700))
        name.returnPressed.connect(lambda: _schedule_quick_save(self, 0))
        weight.returnPressed.connect(lambda: _schedule_quick_save(self, 0))
        note.returnPressed.connect(lambda: _schedule_quick_save(self, 0))

        self.detail_grid_widget.setObjectName("quickEditPanel")
        self.detail_grid_widget.setStyleSheet(
            "QWidget#quickEditPanel { background:#FFFFFF; border:1px solid #DDE3EA; border-radius:10px; }"
        )
        self.detail_grid_widget.setVisible(True)

    def _save_quick_item(self):
        _ensure_quick_bridge(self)
        if getattr(self, "_quick_save_inflight", False):
            self._quick_save_pending = True
            return

        item = getattr(self, "_quick_edit_item", None) or getattr(self, "_viewing_item", None)
        mw = self.window()
        sheets = getattr(mw, "sheets", None) or getattr(mw, "sheets_manager", None)
        if not item or item.get("row") is None:
            if hasattr(mw, "toast"):
                mw.toast.show_toast("수정할 개체를 다시 선택해주세요.", "warning")
            return
        if not sheets or not getattr(sheets, "write_enabled", False):
            if hasattr(mw, "toast"):
                detail = getattr(sheets, "last_write_error", "") if sheets else ""
                mw.toast.show_toast(detail or "데이터 쓰기 연결이 되어 있지 않습니다.", "warning")
            return

        name = self._quick_name.text().strip()
        if not name:
            if hasattr(mw, "toast"):
                mw.toast.show_toast("개체명은 비워둘 수 없습니다.", "warning")
            return
        gender = str(self._quick_gender.currentData() or "U")
        weight = self._quick_weight.text().strip().replace("g", "")
        note = self._quick_note.text().strip()
        updated = dict(item)
        updated["name"] = name
        updated["checklist"] = _update_checklist(item.get("checklist", ""), gender, weight)
        updated["note"] = note

        data = {
            "rowNum": updated.get("row"),
            "company": updated.get("company", ""),
            "name": updated.get("name", ""),
            "startPrice": updated.get("startPrice", updated.get("price", "")),
            "note": note,
            "announce": updated.get("announce", ""),
            "photoItem": updated.get("photoItem", ""),
            "photoSire": updated.get("photoSire", ""),
            "photoDam": updated.get("photoDam", ""),
            "photoSibling": updated.get("photoSibling", ""),
            "checklist": updated.get("checklist", ""),
            "sire_id": updated.get("sire_id", updated.get("sireId", "")),
            "dam_id": updated.get("dam_id", updated.get("damId", "")),
        }

        # Platform item edits are sent as a complete record.  While an auction
        # is live, an edit card can still contain the pre-start standby status;
        # sending that stale record makes the public P2 item disappear.  Pin
        # the status to the authoritative MainWindow active item whenever the
        # edited row is the live row.
        active_item = getattr(mw, "active_item", None) or {}
        active_row = active_item.get("row")
        if active_row is not None and str(active_row) == str(updated.get("row")):
            data["status"] = _core.S_ACTIVE
            updated["status"] = _core.S_ACTIVE

        self._quick_save_inflight = True
        self._quick_save_pending = False

        def _worker():
            ok, error = False, ""
            try:
                ok = bool(sheets.update_item(data))
                if not ok:
                    error = getattr(sheets, "last_write_error", "") or "저장하지 못했습니다."
            except Exception as exc:
                error = str(exc)
            self._quick_edit_bridge.sig_done.emit(ok, error, updated)

        threading.Thread(target=_worker, daemon=True).start()

    def _on_quick_save_done(self, ok, error, updated):
        self._quick_save_inflight = False
        mw = self.window()
        if not ok:
            if hasattr(mw, "toast"):
                mw.toast.show_toast(f"자동 저장 실패: {error}", "error")
        else:
            row = updated.get("row")
            for existing in getattr(mw, "items", []) or []:
                if existing is updated or (row is not None and existing.get("row") == row):
                    existing.update(updated)
                    break
            current = getattr(self, "_quick_edit_item", None)
            if current is not None and (current is updated or (row is not None and current.get("row") == row)):
                current.update(updated)

        if getattr(self, "_quick_save_pending", False):
            self._quick_save_pending = False
            self._quick_autosave_timer.start(0)

    def show_item_detail(self, item):
        result = original_show_item_detail(self, item)
        self.lbl_start_price.setText(str((item or {}).get("company") or ""))
        return result

    def set_active(self, item):
        result = original_set_active(self, item)
        self.lbl_start_price.setText(str((item or {}).get("company") or ""))
        return result

    AuctionCardWidget.__init__ = __init__
    AuctionCardWidget._update_detail_grid = _update_detail_grid
    AuctionCardWidget._save_quick_item = _save_quick_item
    AuctionCardWidget._schedule_quick_save = _schedule_quick_save
    AuctionCardWidget.show_item_detail = show_item_detail
    AuctionCardWidget.set_active = set_active


def _patch_chat_shortcuts():
    ChatWidget = _core.ChatWidget
    original_init = ChatWidget.__init__
    original_append_msg = ChatWidget.append_msg

    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        try:
            self.chat_log.document().setMaximumBlockCount(150)
        except Exception:
            pass

    def _load_quick_messages_manual_only(self):
        return []

    def _save_quick_messages_manual_only(self):
        return None

    def _show_quick_menu_manual_only(self):
        menu = _core.QMenu(self)
        menu.setStyleSheet("""
            QMenu { background: #FFFFFF; border: 1px solid #EAECEE; border-radius: 8px; padding: 6px; min-width: 220px; }
            QMenu::item { padding: 10px 16px; font-size: 13px; font-weight: 700; color: #333333; border-radius: 4px; }
            QMenu::item:selected { background: #F0F4FF; color: #093687; }
        """)
        a_highest = menu.addAction("현재 최고 입찰자 전송")
        a_winner = menu.addAction("낙찰자 전송")
        menu.addSeparator()
        a_auction_status = menu.addAction("현재 경매 정보 전송")

        def main_window():
            win = self.window()
            return win if win and win is not self else None

        a_highest.triggered.connect(lambda: getattr(main_window(), "_send_current_highest_chat", lambda: None)())
        a_winner.triggered.connect(lambda: getattr(main_window(), "_send_current_winner_chat", lambda: None)())
        a_auction_status.triggered.connect(lambda: getattr(main_window(), "_send_current_auction_status_chat", lambda: None)())

        pos = self.btn_plus.mapToGlobal(self.btn_plus.rect().topLeft())
        menu.exec_(pos - _core.QPoint(0, menu.sizeHint().height()))

    def append_msg_light(self, name, text, t="", is_bid=False):
        original_append_msg(self, name, text, t, is_bid)
        try:
            if len(self._messages) > 300:
                self._messages = self._messages[-150:]
        except Exception:
            pass

    ChatWidget._load_quick_messages = _load_quick_messages_manual_only
    ChatWidget._save_quick_messages = _save_quick_messages_manual_only
    ChatWidget._show_quick_menu = _show_quick_menu_manual_only
    ChatWidget.__init__ = __init__
    ChatWidget.append_msg = append_msg_light


def _patch_main_window():
    MainWindow = _core.MainWindow
    original_init = MainWindow.__init__
    original_start_auction = MainWindow._start_auction
    original_end_auction = MainWindow._end_auction
    original_on_connect_done_inner = MainWindow._on_connect_done_inner
    original_add_bid = MainWindow._add_bid
    original_on_sold = MainWindow._on_sold
    original_on_chat_send_done = MainWindow._on_chat_send_done
    original_normalize_bid_entries = MainWindow._normalize_bid_entries

    def _normalize_bid_entries(self, raw):
        source = raw
        if isinstance(source, str):
            try:
                source = json.loads(source) if source.strip() else []
            except (TypeError, ValueError):
                source = []
        normalized = original_normalize_bid_entries(self, source)
        if not isinstance(source, list):
            return normalized

        # The recovered core intentionally normalizes bids down to four fields.
        # Preserve namespaced entry metadata and a confirmed quiz answer. The
        # answer is added only after a correct chat message, never beforehand.
        for index, bid in enumerate(normalized):
            if index >= len(source) or not isinstance(source[index], dict):
                continue
            entry_type = str(source[index].get("entry_type") or "").strip()
            sale_mode = str(source[index].get("sale_mode") or "").strip()
            quiz_answer = str(source[index].get("answer") or "").strip()
            if entry_type:
                bid["entry_type"] = entry_type
            if sale_mode:
                bid["sale_mode"] = sale_mode
            if quiz_answer:
                bid["answer"] = quiz_answer
        return normalized

    def _chat_poll_interval_ms(self):
        if getattr(self, "_label_print_jobs", 0) > 0:
            return 4000
        if getattr(self, "_poll_fail", 0) >= 3:
            return 5000
        if getattr(self, "active_item", None):
            return 1200
        return 2500

    def _update_chat_poll_timer(self):
        timer = getattr(self, "poll_timer", None)
        if timer is not None:
            timer.setInterval(_chat_poll_interval_ms(self))

    def _check_poll_inflight_stuck(self):
        """Safety: reset _chat_poll_inflight if stuck for >12 seconds."""
        if not getattr(self, "_chat_poll_inflight", False):
            self._chat_poll_inflight_since = 0
            return
        since = getattr(self, "_chat_poll_inflight_since", 0)
        if not since:
            # First detection — core set inflight=True but not the timestamp
            self._chat_poll_inflight_since = time.monotonic()
            return
        if (time.monotonic() - since) > 12:
            self._chat_poll_inflight = False
            self._chat_poll_inflight_since = 0
            self._poll_fail = min(getattr(self, "_poll_fail", 0) + 1, 5)
            print("[Chat] poll inflight reset (stuck >12s)", flush=True)
            _append_chat_debug_log("poll inflight force-reset after 12s timeout")

    def _ensure_seen_msg_order(self):
        order = getattr(self, "_seen_msg_order", None)
        if order is None:
            order = deque()
            for key in list(getattr(self, "_seen_msgs", set()))[-KEEP_SEEN_CHAT_KEYS:]:
                order.append(key)
            self._seen_msg_order = order
        return order

    def _remember_seen_msg(self, key):
        if not key:
            return
        if key in self._seen_msgs:
            return
        self._seen_msgs.add(key)
        order = _ensure_seen_msg_order(self)
        order.append(key)
        while len(order) > MAX_SEEN_CHAT_KEYS:
            old_key = order.popleft()
            self._seen_msgs.discard(old_key)

    def _trim_seen_msgs(self):
        order = _ensure_seen_msg_order(self)
        if len(self._seen_msgs) <= MAX_SEEN_CHAT_KEYS and len(order) <= MAX_SEEN_CHAT_KEYS:
            return
        while len(order) > KEEP_SEEN_CHAT_KEYS:
            old_key = order.popleft()
            self._seen_msgs.discard(old_key)
        if len(self._seen_msgs) > MAX_SEEN_CHAT_KEYS:
            self._seen_msgs = set(order)

    def _flush_pending_bid_save(self, row):
        pending = getattr(self, "_pending_bid_save_payloads", {})
        payload = pending.pop(row, None)
        timer = getattr(self, "_pending_bid_save_timers", {}).get(row)
        if timer is not None:
            timer.stop()
        if payload is None:
            return
        self._bid_save_last_queued_at[row] = time.monotonic()
        self._queue_result_save(row, payload, "Bid sheet save failed")

    def _drop_pending_bid_save(self, row):
        if not row:
            return
        pending = getattr(self, "_pending_bid_save_payloads", {})
        pending.pop(row, None)
        timer = getattr(self, "_pending_bid_save_timers", {}).get(row)
        if timer is not None:
            timer.stop()

    def _schedule_bid_sheet_save(self, row, payload):
        if not row:
            return
        self._pending_bid_save_payloads[row] = payload
        now = time.monotonic()
        last = self._bid_save_last_queued_at.get(row, 0.0)
        remaining = BID_SAVE_MIN_INTERVAL_SEC - (now - last)
        if remaining <= 0:
            _flush_pending_bid_save(self, row)
            return

        timer = self._pending_bid_save_timers.get(row)
        if timer is None:
            timer = _core.QTimer(self)
            timer.setSingleShot(True)
            timer.timeout.connect(lambda r=row: _flush_pending_bid_save(self, r))
            self._pending_bid_save_timers[row] = timer
        timer.start(max(150, int(remaining * 1000)))

    def _manual_amount_text(amount):
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            return str(amount or "")
        if amount == int(amount):
            return str(int(amount))
        return str(amount).rstrip("0").rstrip(".")

    def _parse_manual_amount(text):
        parsed = _core.parse_bid(str(text or ""))
        if parsed is not None:
            return float(parsed)
        cleaned = (
            str(text or "")
            .strip()
            .replace(",", "")
            .replace("만원", "")
            .replace("만", "")
            .replace("원", "")
        )
        amount = float(cleaned)
        if amount >= 1000:
            amount = amount / 10000
        return amount

    def _normalize_money_text(value):
        text = str(value or "").strip()
        if not text:
            return ""
        try:
            return _manual_amount_text(_parse_manual_amount(text))
        except (TypeError, ValueError):
            return text

    def _manual_bid_defaults(self):
        bids = []
        if getattr(self, "active_item", None):
            bids = self._normalize_bid_entries(self.active_item.get("bids", []))
        if bids:
            top = bids[0]
            return str(top.get("name", "")), _manual_amount_text(top.get("amount", ""))
        return "", ""

    def _prompt_manual_bid(self, title, default_name=None, default_amount=None):
        if default_name is None or default_amount is None:
            fallback_name, fallback_amount = _manual_bid_defaults(self)
            if default_name is None:
                default_name = fallback_name
            if default_amount is None:
                default_amount = fallback_amount
        name, ok = _core.QInputDialog.getText(
            self,
            title,
            "입찰자 이름:",
            _core.QLineEdit.Normal,
            default_name,
        )
        if not ok or not str(name).strip():
            return None
        amount_text, ok = _core.QInputDialog.getText(
            self,
            title,
            "금액(만원):",
            _core.QLineEdit.Normal,
            default_amount,
        )
        if not ok or not str(amount_text).strip():
            return None
        try:
            amount = _parse_manual_amount(amount_text)
        except (TypeError, ValueError):
            self.toast.show_toast("금액을 숫자로 입력해주세요.", "warning")
            return None
        if amount <= 0:
            self.toast.show_toast("금액을 0보다 크게 입력해주세요.", "warning")
            return None
        return str(name).strip(), amount

    def _current_top_bid(self):
        if not getattr(self, "active_item", None):
            self.toast.show_toast("진행 중인 경매가 없습니다.", "warning")
            return None
        bids = self._normalize_bid_entries(self.active_item.get("bids", []))
        if not bids:
            self.toast.show_toast("입찰 리스트가 비어 있습니다.", "warning")
            return None
        self.active_item["bids"] = bids
        return bids[0]

    def _quiz_display_winner(name):
        raw = _normalize_winner_text(name)
        without_phone = re.sub(r"(?<!\d)010[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)", "", raw)
        parts = [part.strip() for part in re.split(r"[/|·]+", without_phone) if part.strip()]
        if len(parts) >= 2:
            return f"{parts[0]} - {parts[-1]}"
        parsed_name, _ = _core.parse_winner(raw)
        display_name = parsed_name or without_phone or raw
        display_name = re.sub(r"\s*[./|·]+\s*", " - ", str(display_name or ""))
        return re.sub(r"\s+", " ", display_name).strip(" -")

    def _record_quiz_answer(self, name, t="", bidder_key="", answer_text=""):
        item = getattr(self, "active_item", None)
        if not item or not _quiz_item_meta(item).get("is_quiz"):
            return False
        bids = self._normalize_bid_entries(item.get("bids", []))
        if bids:
            return False

        name = _normalize_winner_text(name)
        bidder_key = str(bidder_key or name).strip() or name
        if not str(name or "").strip() or not bidder_key:
            return False
        bid = {
            "name": name,
            "bidder_key": bidder_key,
            "amount": 0.0,
            "time": str(t or time.strftime("%H:%M:%S")),
            "entry_type": "quiz_winner",
            "sale_mode": "quiz",
            "answer": _normalize_quiz_answer(answer_text),
        }
        item["bids"] = [bid]
        self._persist_bid_state_async(item, [bid])
        self.auction_card.update_bids([bid])

        if self.config.get("auto_chat_enabled", True):
            display_name = _quiz_display_winner(name)
            answer = bid.get("answer") or _quiz_item_meta(item).get("answer", "")
            self._queue_chat_send(
                f"⠀⠀🔴 정답! {answer}⠀⠀\n⠀⠀ㅤ  {display_name}⠀⠀",
                "퀴즈 정답 안내 전송 실패",
            )
        return True

    def _record_manual_bid(self, name, amount, force_top=True):
        if not getattr(self, "active_item", None):
            self.toast.show_toast("진행 중인 경매가 없습니다.", "warning")
            return False
        name = _normalize_winner_text(name)
        bidder_key = str(name or "").strip()
        if not bidder_key:
            return False

        bids = self._normalize_bid_entries(self.active_item.get("bids", []))
        kept = []
        for bid in bids:
            bid_key = str(bid.get("bidder_key") or bid.get("name", "")).strip()
            if bid_key == bidder_key:
                continue
            try:
                bid_amount = float(bid.get("amount", 0) or 0)
            except (TypeError, ValueError):
                bid_amount = 0
            if force_top and bid_amount > amount:
                continue
            kept.append(bid)

        now_text = time.strftime("%H:%M:%S")
        kept.append({
            "name": bidder_key,
            "bidder_key": bidder_key,
            "amount": float(amount),
            "time": now_text,
        })
        kept.sort(key=lambda bid: bid.get("amount", 0), reverse=True)
        self.active_item["bids"] = kept
        self._persist_bid_state_async(self.active_item, kept)
        self.auction_card.update_bids(kept)
        try:
            self.chat_w.append_msg("수동 입력", f"{bidder_key} {_core.fmt_price(amount)}", now_text, True)
        except Exception:
            pass
        return True

    def _format_manual_chat(self, template_key, name, amount):
        item = getattr(self, "active_item", None) or {}
        if _quiz_item_meta(item).get("is_quiz"):
            display_name = _quiz_display_winner(name)
            bids = self._normalize_bid_entries(item.get("bids", []))
            answer = (bids[0].get("answer") if bids else "") or _quiz_item_meta(item).get("answer", "")
            if template_key == "highest":
                return f"⠀⠀🔴 정답! {answer}⠀⠀\n⠀⠀ㅤ  {display_name}⠀⠀"
            if template_key == "sold":
                return f"⠀⠀🟢 퀴즈 당첨 {item.get('name', '')}\n⠀⠀ㅤ  {display_name}"
        tpl = self.config.get("templates", {}).get(template_key, "")
        display_name = name
        if template_key in {"highest", "sold"}:
            parsed_name, _ = _core.parse_winner(name)
            display_name = parsed_name or name
            display_name = re.sub(r"\s*[./|·]+\s*", " ", display_name)
            display_name = re.sub(r"\s+", " ", display_name).strip()
        values = {
            "num": item.get("num", ""),
            "name": item.get("name", ""),
            "price": item.get("price", ""),
            "sold_price": _manual_amount_text(amount),
            "winner": display_name,
        }
        try:
            msg = tpl.format(**values) if tpl else ""
        except KeyError as exc:
            self.toast.show_toast(f"채팅 문구 변수 오류: {exc}", "error")
            return ""
        msg = msg.replace("\\r\\n", "\n").replace("\\n", "\n")
        if msg:
            return msg
        if template_key == "sold":
            sold_price_text = _core.fmt_price(amount)
            if sold_price_text.endswith("만"):
                sold_price_text += "원"
            return f"⠀⠀🟢 낙찰 {values['name']}\n⠀⠀ㅤ  {sold_price_text} {display_name}".strip()
        highest_price = _core.fmt_price(amount)
        if highest_price.endswith("만"):
            highest_price += "원"
        return f"⠀⠀🔴 입찰 {highest_price} {display_name}⠀⠀"

    def _send_current_highest_chat(self):
        top = _current_top_bid(self)
        if not top:
            return
        name, amount = top.get("name", ""), top.get("amount", 0)
        msg = _format_manual_chat(self, "highest", name, amount)
        if msg:
            self._queue_chat_send(msg, "현재 최고 입찰자 전송 실패")

    def _send_current_winner_chat(self):
        top = _current_top_bid(self)
        if not top:
            return
        name, amount = top.get("name", ""), top.get("amount", 0)
        msg = _format_manual_chat(self, "sold", name, amount)
        if msg:
            self._queue_chat_send(msg, "낙찰자 전송 실패")

    def _send_current_auction_status_chat(self):
        item = getattr(self, "active_item", None)
        if not item:
            self.toast.show_toast("진행 중인 경매가 없습니다.", "warning")
            return

        raw_code = str(item.get("name") or item.get("num") or "").strip().upper()
        code_match = re.match(r"^([A-Z])(\d+)", raw_code)
        auction_meta = _auction_checklist_meta(item)
        parts = []
        if auction_meta["auction_type"] == "tournament" and auction_meta["tournament_stage"] == 4:
            company = str(item.get("company") or "").strip()
            parts.append("┃ 실시간 경매 · 3라운드 개인전")
            parts.append(f"┃ {raw_code or auction_meta['tournament_code']}" + (f" · {company}" if company else "") + " 진행중")
        elif auction_meta["auction_type"] == "tournament" and code_match:
            letter, round_text = code_match.groups()
            group = ((ord(letter) - ord("A")) // 2) + 1
            parts.append(f"┃ 실시간 경매 · {int(round_text)}라운드 {group}조")
            parts.append(f"┃ {letter}{int(round_text)} 진행중")
        elif raw_code:
            parts.append(f"┃ 실시간 경매 · {raw_code} 진행중")
        else:
            parts.append("┃ 실시간 경매 · 진행중")

        bids = self._normalize_bid_entries(item.get("bids", []))
        if bids:
            parts.append(f"┃ 현재 최고가 {_manual_amount_text(bids[0].get('amount', 0))}만원")
        else:
            parts.append("┃ 입찰 대기")

        self._queue_chat_send("\n".join(parts), "현재 경매 정보 전송 실패")

    def _countdown_current_bids(self):
        item = getattr(self, "active_item", None)
        if not item:
            return []
        return self._normalize_bid_entries(item.get("bids", []))

    def _countdown_current_top_signature(self):
        return _countdown_top_signature(_countdown_current_bids(self))

    def _countdown_is_locked(self):
        return getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE) == AUCTION_COUNTDOWN_LOCKED

    def _countdown_button_style(state):
        if state in {AUCTION_COUNTDOWN_RUNNING, AUCTION_COUNTDOWN_LOCK_PENDING}:
            return (
                "QPushButton { background:#FFF4E8; color:#A84300; border:1px solid #F5B97A; "
                "border-radius:7px; font-size:11px; font-weight:850; padding:0 6px; }"
                "QPushButton:hover { background:#FFE8D1; border-color:#E89542; }"
            )
        if state == AUCTION_COUNTDOWN_LOCKED:
            return (
                "QPushButton { background:#0B7A55; color:#FFFFFF; border:1px solid #0B7A55; "
                "border-radius:7px; font-size:12px; font-weight:900; padding:0 7px; }"
                "QPushButton:hover { background:#086544; border-color:#086544; }"
            )
        return (
            "QPushButton { background:#FFF9EE; color:#8A5A00; border:1px solid #E9C77C; "
            "border-radius:7px; font-size:11px; font-weight:850; padding:0 6px; }"
            "QPushButton:hover { background:#FFF0CF; border-color:#D8AA4E; }"
        )

    def _update_auction_countdown_button(self):
        card = getattr(self, "auction_card", None)
        button = getattr(card, "btn_countdown", None) if card is not None else None
        if button is None:
            return
        item = getattr(self, "active_item", None)
        is_quiz = bool(item and _quiz_item_meta(item).get("is_quiz"))
        state = getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE)
        button.setVisible(bool(item) and not is_quiz)
        button.setEnabled(bool(item) and not is_quiz)
        if state in {AUCTION_COUNTDOWN_RUNNING, AUCTION_COUNTDOWN_LOCK_PENDING}:
            button.setText("카운트 취소")
            if state == AUCTION_COUNTDOWN_LOCK_PENDING:
                button.setToolTip("BAND 채팅에서 빈칸 표시의 순서를 확인하고 있습니다.")
            else:
                button.setToolTip("진행 중인 마감 카운트를 취소합니다.")
        elif state == AUCTION_COUNTDOWN_LOCKED:
            button.setText("입찰 OK")
            button.setToolTip("왼쪽에서 수동 입력한 입찰을 승인하고 노란색 3칸부터 재개합니다.")
        else:
            button.setText("마감 카운트")
            button.setToolTip("입찰 마감 카운트를 시작합니다.")
        button.setStyleSheet(_countdown_button_style(state))

    def _set_auction_countdown_state(self, state):
        self._auction_countdown_state = state
        _update_auction_countdown_button(self)

    def _stop_auction_countdown(self, announce=False):
        timer = getattr(self, "_auction_countdown_timer", None)
        if timer is not None:
            timer.stop()
        self._auction_countdown_generation = getattr(self, "_auction_countdown_generation", 0) + 1
        self._auction_countdown_sequence = ()
        self._auction_countdown_stage_index = 0
        self._auction_countdown_item_key = ""
        self._auction_countdown_locked_top = None
        self._auction_countdown_late_bids = []
        self._auction_countdown_lock_marker_pending = False
        _set_auction_countdown_state(self, AUCTION_COUNTDOWN_IDLE)
        if announce and getattr(self, "active_item", None):
            self._queue_chat_send("마감 카운트를 취소했습니다.", "카운트 취소 안내 전송 실패")

    def _init_auction_countdown(self):
        self._auction_countdown_generation = 0
        self._auction_countdown_sequence = ()
        self._auction_countdown_stage_index = 0
        self._auction_countdown_item_key = ""
        self._auction_countdown_locked_top = None
        self._auction_countdown_late_bids = []
        self._auction_countdown_lock_marker_pending = False
        self._auction_countdown_timer = _core.QTimer(self)
        self._auction_countdown_timer.setSingleShot(True)
        self._auction_countdown_timer.timeout.connect(lambda: _advance_auction_countdown(self))
        card = getattr(self, "auction_card", None)
        button = getattr(card, "btn_countdown", None) if card is not None else None
        handler = getattr(self, "_on_auction_countdown_action", None)
        if button is not None and callable(handler):
            try:
                button.clicked.disconnect()
            except (TypeError, RuntimeError):
                pass
            button.clicked.connect(lambda _checked=False: handler())
            self._auction_countdown_button_bound = True
        _set_auction_countdown_state(self, AUCTION_COUNTDOWN_IDLE)

    def _begin_auction_countdown(self, resume=False, announce=False):
        item = getattr(self, "active_item", None)
        if not item:
            self.toast.show_toast("진행 중인 경매가 없습니다.", "warning")
            return False
        if _quiz_item_meta(item).get("is_quiz"):
            self.toast.show_toast("퀴즈 진행에는 마감 카운트를 사용할 수 없습니다.", "warning")
            return False

        timer = getattr(self, "_auction_countdown_timer", None)
        if timer is None:
            _init_auction_countdown(self)
            timer = self._auction_countdown_timer
        timer.stop()
        self._auction_countdown_generation = getattr(self, "_auction_countdown_generation", 0) + 1
        self._auction_countdown_sequence = (
            AUCTION_COUNTDOWN_RESUME_STAGES if resume else AUCTION_COUNTDOWN_INITIAL_STAGES
        )
        self._auction_countdown_stage_index = 0
        self._auction_countdown_item_key = _countdown_item_key(item)
        self._auction_countdown_locked_top = None
        self._auction_countdown_late_bids = []
        self._auction_countdown_lock_marker_pending = False
        _set_auction_countdown_state(self, AUCTION_COUNTDOWN_RUNNING)

        if announce:
            self._queue_chat_send(AUCTION_COUNTDOWN_ANNOUNCEMENT, "마감 카운트 안내 전송 실패")
        delay = (
            AUCTION_COUNTDOWN_RESUME_DELAY_MS if resume
            else AUCTION_COUNTDOWN_FIRST_MESSAGE_DELAY_MS
        )
        timer.start(delay)
        return True

    def _advance_auction_countdown(self):
        if getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE) != AUCTION_COUNTDOWN_RUNNING:
            return
        item = getattr(self, "active_item", None)
        if not item or _countdown_item_key(item) != getattr(self, "_auction_countdown_item_key", ""):
            _stop_auction_countdown(self)
            return

        sequence = getattr(self, "_auction_countdown_sequence", ())
        index = getattr(self, "_auction_countdown_stage_index", 0)
        if index >= len(sequence):
            _lock_auction_bidding(self)
            return

        message, duration_ms = sequence[index]
        self._auction_countdown_stage_index = index + 1
        self._queue_chat_send(message, "마감 카운트 전송 실패")
        self._auction_countdown_timer.start(int(duration_ms))

    def _lock_auction_bidding(self):
        if getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE) != AUCTION_COUNTDOWN_RUNNING:
            return
        timer = getattr(self, "_auction_countdown_timer", None)
        if timer is not None:
            timer.stop()
        self._auction_countdown_lock_marker_pending = True
        _set_auction_countdown_state(self, AUCTION_COUNTDOWN_LOCK_PENDING)
        self._queue_chat_send(AUCTION_COUNTDOWN_LOCK_MESSAGE, AUCTION_COUNTDOWN_LOCK_SEND_LABEL)
        _append_chat_debug_log(
            "countdown lock marker queued "
            f"item={getattr(self, '_auction_countdown_item_key', '')!r}"
        )

    def _confirm_auction_lock_boundary(self):
        if not getattr(self, "_auction_countdown_lock_marker_pending", False):
            return False
        item = getattr(self, "active_item", None)
        if not item or _countdown_item_key(item) != getattr(self, "_auction_countdown_item_key", ""):
            _stop_auction_countdown(self)
            return False
        self._auction_countdown_lock_marker_pending = False
        self._auction_countdown_locked_top = _countdown_current_top_signature(self)
        self._auction_countdown_late_bids = []
        _set_auction_countdown_state(self, AUCTION_COUNTDOWN_LOCKED)
        self.toast.show_toast("입찰이 잠겼습니다. 낙찰 또는 수동 입찰 승인을 선택하세요.", "success")
        _append_chat_debug_log(
            "countdown locked at observed chat marker "
            f"item={getattr(self, '_auction_countdown_item_key', '')!r} "
            f"top={getattr(self, '_auction_countdown_locked_top', None)!r}"
        )
        return True

    def _record_locked_late_bid(self, name, amount, t="", bidder_key="", text=""):
        entries = getattr(self, "_auction_countdown_late_bids", None)
        if entries is None:
            entries = []
            self._auction_countdown_late_bids = entries
        entries.append({
            "name": _normalize_winner_text(name),
            "bidder_key": str(bidder_key or name).strip(),
            "amount": amount,
            "time": str(t or ""),
            "text": str(text or ""),
        })
        if len(entries) > 50:
            del entries[:-50]
        _append_chat_debug_log(
            f"bid ignored after countdown lock name={name!r} amount={amount!r} time={t!r}"
        )

    def _approve_manual_bid_and_resume(self):
        if not _countdown_is_locked(self):
            return False
        current_top = _countdown_current_top_signature(self)
        locked_top = getattr(self, "_auction_countdown_locked_top", None)
        if current_top is None or current_top == locked_top:
            self.toast.show_toast(
                "왼쪽 입찰 목록에서 승인할 입찰자와 금액을 입력하거나 수정해 주세요.",
                "warning",
            )
            return False

        bids = _countdown_current_bids(self)
        top = bids[0]
        msg = _format_manual_chat(self, "highest", top.get("name", ""), top.get("amount", 0))
        if msg:
            self._queue_chat_send(msg, "수동 승인 입찰 전송 실패")
        if not _begin_auction_countdown(self, resume=True, announce=False):
            return False
        self.toast.show_toast("수동 입찰을 반영하고 노란색 3칸부터 재개합니다.", "success")
        _append_chat_debug_log(
            f"manual bid approved after lock previous={locked_top!r} current={current_top!r}"
        )
        return True

    def _on_auction_countdown_action(self):
        state = getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE)
        _append_chat_debug_log(
            f"countdown button clicked state={state!r} "
            f"active={_countdown_item_key(getattr(self, 'active_item', None))!r}"
        )
        if state == AUCTION_COUNTDOWN_LOCKED:
            _approve_manual_bid_and_resume(self)
            return
        if state in {AUCTION_COUNTDOWN_RUNNING, AUCTION_COUNTDOWN_LOCK_PENDING}:
            answer = _core.QMessageBox.question(
                self,
                "마감 카운트 취소",
                "진행 중인 마감 카운트를 취소할까요?",
                _core.QMessageBox.Yes | _core.QMessageBox.No,
                _core.QMessageBox.No,
            )
            if answer == _core.QMessageBox.Yes:
                _stop_auction_countdown(self, announce=True)
            return
        _begin_auction_countdown(self, resume=False, announce=True)

    def _restart_countdown_after_accepted_bid(self, previous_top):
        if getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE) != AUCTION_COUNTDOWN_RUNNING:
            return
        current_top = _countdown_current_top_signature(self)
        if current_top is None or current_top == previous_top:
            return
        sequence = getattr(self, "_auction_countdown_sequence", ())
        stage_index = int(getattr(self, "_auction_countdown_stage_index", 0) or 0)
        if (
            sequence == AUCTION_COUNTDOWN_INITIAL_STAGES
            and stage_index <= AUCTION_COUNTDOWN_GREEN_STAGE_COUNT
        ):
            _append_chat_debug_log(
                "countdown kept in green after bid "
                f"stage={stage_index} previous={previous_top!r} current={current_top!r}"
            )
            return
        _begin_auction_countdown(self, resume=True, announce=False)
        _append_chat_debug_log(
            f"countdown reset to yellow previous={previous_top!r} current={current_top!r}"
        )

    def _on_chat_send_done(self, payload):
        result = original_on_chat_send_done(self, payload)
        if not payload.get("ok"):
            label = payload.get("label")
            if (
                label == AUCTION_COUNTDOWN_LOCK_SEND_LABEL
                and getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE)
                == AUCTION_COUNTDOWN_LOCK_PENDING
            ):
                _stop_auction_countdown(self)
                self.toast.show_toast(
                    "빈칸 표시를 전송하지 못해 입찰 잠금을 해제했습니다. 카운트를 다시 시작해 주세요.",
                    "error",
                )
            elif label in {
                "마감 카운트 안내 전송 실패",
                "마감 카운트 전송 실패",
                "수동 승인 입찰 전송 실패",
            } and getattr(self, "_auction_countdown_state", AUCTION_COUNTDOWN_IDLE) == AUCTION_COUNTDOWN_RUNNING:
                _stop_auction_countdown(self)
                self.toast.show_toast(
                    "카운트 메시지를 전송하지 못해 마감 카운트를 중단했습니다.",
                    "error",
                )
        return result

    def _configure_item_table(self):
        table = getattr(self, "item_table", None)
        if table is None:
            return
        table.setColumnCount(4)
        table.setHorizontalHeaderLabels(["번호", "업체", "개체", "결과"])
        header = table.horizontalHeader()
        header.setSectionResizeMode(0, _core.QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, _core.QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, _core.QHeaderView.Stretch)
        header.setSectionResizeMode(3, _core.QHeaderView.ResizeToContents)

    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        _init_auction_countdown(self)
        _configure_item_table(self)
        # Replace SheetsManager with SupabaseManager if configured
        if hasattr(self, "config") and (self.config.get("capture_service_url") or self.config.get("supabase_url")):
            self.sheets = _create_data_manager(self.config)
            self.sheets_manager = self.sheets
        _sync_auction_animation_config(self.config, getattr(self, "sheets", None))
        self._label_print_jobs = 0
        self._pending_label_prints = []
        self._label_print_current_job_id = None
        self._last_auto_label_key = None
        self._last_chat_mutation_seq = 0
        self._auction_start_mutation_seq = 0
        self._buy_now_key_last_item = {}
        self._seen_msg_order = deque()
        self._pending_bid_save_payloads = {}
        self._pending_bid_save_timers = {}
        self._bid_save_last_queued_at = {}
        self._chat_poll_inflight_since = 0
        _install_label_reprint_button(self)
        _update_chat_poll_timer(self)
        # Safety timer: check for stuck polls every 5 seconds
        self._poll_stuck_timer = _core.QTimer(self)
        self._poll_stuck_timer.setInterval(5000)
        self._poll_stuck_timer.timeout.connect(lambda: _check_poll_inflight_stuck(self))
        self._poll_stuck_timer.start()
        # Start WebSocket chat listener (replaces heavy DOM polling)
        def _delayed_ws_start():
            cdp = getattr(self, "cdp", None)
            if cdp:
                cdp._start_ws_chat_listener()
                # Inject Chrome optimizer after a short delay
                _core.QTimer.singleShot(5000, lambda: cdp._inject_chrome_optimizer())
        _core.QTimer.singleShot(2000, _delayed_ws_start)
        if getattr(self, "items", None):
            self._refresh_table()

    def _on_connect_done_inner(self, items, tabs, cdp_ok):
        if items is not None and not getattr(self, "active_item", None):
            _restore_active_auction_session(self, items)
        return original_on_connect_done_inner(self, items, tabs, cdp_ok)

    def _auction_filter_mode(self):
        filter_value = getattr(self, "_filter", "")
        filter_keys = list(getattr(self, "_filter_btns", {}).keys())
        if filter_value in filter_keys:
            idx = filter_keys.index(filter_value)
            return ("all", "wait", "active", "done")[idx] if idx < 4 else "all"

        text = str(filter_value or "").lower()
        if "wait" in text or "\ub300\uae30" in text:
            return "wait"
        if "active" in text or "\uc9c4\ud589" in text:
            return "active"
        if "done" in text or "\uc644\ub8cc" in text:
            return "done"
        return "all"

    def _auction_status_rank(status):
        if status == _core.S_ACTIVE:
            return 0
        if status in (_core.S_SOLD, _core.S_UNSOLD, _core.S_CANCEL):
            return 1
        if status == _core.S_WAIT:
            return 2
        return 3

    def _auction_matches_filter(status, mode):
        if mode == "wait":
            return status == _core.S_WAIT
        if mode == "active":
            return status == _core.S_ACTIVE
        if mode == "done":
            return status in (_core.S_SOLD, _core.S_UNSOLD, _core.S_CANCEL)
        return True

    def _refresh_table_sorted(self):
        table = getattr(self, "item_table", None)
        if table is None:
            return

        table.setUpdatesEnabled(False)
        try:
            done, sold_count, total_sales = 0, 0, 0
            mode = _auction_filter_mode(self)
            filtered = []

            for orig_i, item in enumerate(getattr(self, "items", []) or []):
                status = item.get("status", _core.S_WAIT)
                if status in (_core.S_SOLD, _core.S_UNSOLD, _core.S_CANCEL):
                    done += 1
                if status == _core.S_SOLD:
                    sold_count += 1
                    try:
                        total_sales += float(item.get("sold_price", 0) or 0)
                    except (TypeError, ValueError):
                        pass
                if _auction_matches_filter(status, mode):
                    filtered.append((orig_i, item))

            filtered.sort(key=lambda pair: (_auction_status_rank(pair[1].get("status", _core.S_WAIT)), pair[0]))
            table.setRowCount(len(filtered))

            for row, (orig_i, item) in enumerate(filtered):
                status = item.get("status", _core.S_WAIT)
                color = _core.STATUS_COLORS.get(status, "#8E8E93")
                if status == _core.S_SOLD:
                    winner = item.get("winner", "")
                    if _quiz_item_meta(item).get("is_quiz"):
                        result = f"정답!  {winner}" if winner else "정답!"
                    else:
                        sold_price = _core.fmt_price(item.get("sold_price", ""))
                        result = f"{sold_price}  {winner}" if winner else sold_price
                elif status == _core.S_ACTIVE:
                    result = "\uc9c4\ud589\uc911"
                elif status == _core.S_UNSOLD:
                    result = "\uc720\ucc30"
                elif status == _core.S_CANCEL:
                    result = "\ucde8\uc18c"
                else:
                    result = "-"

                row_values = [
                    str(item.get("num", "")),
                    item.get("company", ""),
                    item.get("name", ""),
                    result,
                ]

                for col, value in enumerate(row_values):
                    cell = _core.QTableWidgetItem(str(value))
                    cell.setData(_core.Qt.UserRole, orig_i)

                    if col == 0:
                        cell.setTextAlignment(_core.Qt.AlignCenter | _core.Qt.AlignVCenter)
                        cell.setForeground(_core.QColor("#9CA3AF"))
                        font = _core.QFont()
                        font.setPointSize(9)
                        font.setBold(True)
                        cell.setFont(font)
                    elif col == 1:
                        cell.setTextAlignment(_core.Qt.AlignLeft | _core.Qt.AlignVCenter)
                        cell.setForeground(_core.QColor("#6B7280"))
                    elif col == 2:
                        cell.setTextAlignment(_core.Qt.AlignLeft | _core.Qt.AlignVCenter)
                        cell.setForeground(_core.QColor("#111111"))
                        font = _core.QFont()
                        font.setBold(True)
                        cell.setFont(font)
                    elif col == 3:
                        cell.setTextAlignment(_core.Qt.AlignRight | _core.Qt.AlignVCenter)
                        cell.setForeground(_core.QColor(color))
                        font = _core.QFont()
                        font.setBold(True)
                        cell.setFont(font)

                    if status == _core.S_ACTIVE and col == 0:
                        cell.setData(_core.Qt.UserRole + 1, True)

                    table.setItem(row, col, cell)

            for row in range(table.rowCount()):
                cell = table.item(row, 0)
                if not cell:
                    continue
                orig_i = cell.data(_core.Qt.UserRole)
                if orig_i is not None and orig_i < len(self.items) and self.items[orig_i].get("status") == _core.S_ACTIVE:
                    table.scrollToItem(cell)
                    break

            total = len(getattr(self, "items", []) or [])
            rate = f"{sold_count / total * 100:.0f}%" if total else "0%"
            if hasattr(self, "stat_total"):
                self.stat_total.setText(str(total))
                self.stat_sold.setText(str(sold_count))
                self.stat_sales.setText(_core.fmt_price(total_sales) or "0\ub9cc")
                self.stat_rate.setText(rate)
            if hasattr(self, "lbl_stats"):
                self.lbl_stats.setText(f"{done}/{total} \uc644\ub8cc")
            if hasattr(self, "progress"):
                self.progress.setMaximum(max(total, 1))
                self.progress.setValue(done)
            if hasattr(self, "lbl_progress"):
                if getattr(self, "active_item", None):
                    self.lbl_progress.setText(f"#{self.active_item.get('num', '')} {self.active_item.get('name', '')} \uc9c4\ud589\uc911")
                else:
                    self.lbl_progress.setText("")
        finally:
            table.setUpdatesEnabled(True)

    def _refresh_table_fast_compact(self, changed_items=None):
        _refresh_table_sorted(self)

    def _chat_message_seen_key(self, message, index):
        name = message.get("name", "")
        bidder_key = str(message.get("userKey") or name).strip() or name
        return message.get("messageKey") or f"{bidder_key}:{message.get('time', '')}:{index}:{message.get('text', '')}"

    def _prime_chat_seen_baseline(self):
        try:
            snapshot = self.cdp.get_chat_snapshot() or {}
            mutation_seq = _as_int(snapshot.get("mutationSeq"), 0)
            if mutation_seq:
                self._last_chat_mutation_seq = mutation_seq
                self._auction_start_mutation_seq = mutation_seq
            for idx, message in enumerate(snapshot.get("messages", []) or []):
                key = _chat_message_seen_key(self, message, idx)
                if key:
                    _remember_seen_msg(self, key)
            _append_chat_debug_log(
                f"auction baseline primed messages={len(snapshot.get('messages', []) or [])} mutation={mutation_seq} seen_keys={len(getattr(self, '_seen_msgs', []))}"
            )
        except Exception as exc:
            _append_chat_debug_log(f"auction baseline prime failed: {exc}")

    def _on_chat_poll_done(self, payload):
        self._chat_poll_inflight = False
        self._chat_poll_inflight_since = 0
        self._poll_fail = payload.get("poll_fail", getattr(self, "_poll_fail", 0))
        self._chat_dom_fail = self._poll_fail if payload.get("dom_missing") else 0

        status = payload.get("status")
        if status is not None:
            self._update_status_bar(status)

        if payload.get("error"):
            print(f"[Chat] poll error: {payload['error']}", flush=True)

        msgs = payload.get("msgs", [])
        mutation_seq = _as_int(payload.get("mutationSeq"), 0)
        if mutation_seq:
            self._last_chat_mutation_seq = mutation_seq
        _trim_seen_msgs(self)
        for idx, m in enumerate(msgs):
            try:
                name = _normalize_winner_text(m.get("name", ""))
                text = m.get("text", "")
                display_text = text
                t = m.get("time", "")
                bidder_key = str(m.get("userKey") or name).strip() or name
                if not name or not text:
                    continue
                key = _chat_message_seen_key(self, m, idx)
                is_new_lock_marker = (
                    text.strip() == AUCTION_COUNTDOWN_LOCK_MESSAGE
                    and getattr(self, "_auction_countdown_lock_marker_pending", False)
                    and key not in self._seen_msgs
                )
                if is_new_lock_marker:
                    # The BAND server order is authoritative: every message
                    # handled before this marker remains a valid bid, while
                    # messages handled after it are late and stay unreflected.
                    _confirm_auction_lock_boundary(self)
                buy_now = _is_buy_now_text(text)
                if buy_now:
                    _append_chat_debug_log(
                        f"buy-now snapshot idx={idx} seen={key in self._seen_msgs} key={key!r} name={name!r} time={t!r} active=#{(self.active_item or {}).get('num', '')} mutation={payload.get('mutationSeq', '')}"
                    )
                if key in self._seen_msgs:
                    if buy_now:
                        current_item_key = (
                            (self.active_item or {}).get("row")
                            or (self.active_item or {}).get("num")
                            or ""
                        )
                        last_item_key = getattr(self, "_buy_now_key_last_item", {}).get(key)
                        can_retry_for_new_item = (
                            bool(current_item_key)
                            and last_item_key != current_item_key
                            and mutation_seq > getattr(self, "_auction_start_mutation_seq", 0)
                        )
                        _append_chat_debug_log(
                            f"buy-now duplicate key={key!r} last_item={last_item_key!r} current_item={current_item_key!r} retry={can_retry_for_new_item}"
                        )
                        if not can_retry_for_new_item:
                            continue
                    else:
                        continue
                _remember_seen_msg(self, key)

                is_bid = False
                quiz_meta = _quiz_item_meta(self.active_item)
                if self.active_item and quiz_meta.get("is_quiz"):
                    if quiz_meta.get("answer_configured") and _quiz_answer_matches(quiz_meta, text):
                        is_bid = self._record_quiz_answer(name, t, bidder_key, text)
                        _append_chat_debug_log(
                            f"quiz answer matched accepted={is_bid} name={name!r} active=#{self.active_item.get('num', '')}"
                        )
                else:
                    bid_amount = _core.parse_bid(text)
                    if bid_amount is not None and self.active_item:
                        price = 1
                        try:
                            p = self.active_item.get("price", "")
                            if p and str(p).strip():
                                price = float(p)
                        except (ValueError, TypeError):
                            pass
                        if buy_now or bid_amount >= price:
                            if _countdown_is_locked(self):
                                _record_locked_late_bid(
                                    self,
                                    name,
                                    bid_amount,
                                    t=t,
                                    bidder_key=bidder_key,
                                    text=text,
                                )
                                display_text = f"[마감 후 · 미반영] {text}"
                                # Keep it visible when the operator uses the
                                # bid-only chat filter, without adding it to
                                # the actual bid list or highest-price state.
                                is_bid = True
                            else:
                                is_bid = self._add_bid(name, bid_amount, t, bidder_key)
                            if buy_now:
                                current_item_key = (
                                    (self.active_item or {}).get("row")
                                    or (self.active_item or {}).get("num")
                                    or ""
                                )
                                if current_item_key:
                                    self._buy_now_key_last_item[key] = current_item_key
                                _append_chat_debug_log(
                                    f"buy-now add_bid result={is_bid} name={name!r} bidder_key={bidder_key!r} amount={bid_amount} active=#{self.active_item.get('num', '')}"
                                )
                        elif buy_now:
                            _append_chat_debug_log(
                                f"buy-now skipped by price gate name={name!r} amount={bid_amount} price={price}"
                            )
                    elif buy_now:
                        _append_chat_debug_log(
                            f"buy-now seen but no active item or no amount name={name!r} active={bool(self.active_item)} amount={bid_amount}"
                        )
                self.chat_w.append_msg(name, display_text, t, is_bid)
            except Exception as exc:
                print(f"[Chat] message handling failed: {exc}", flush=True)
                _append_chat_debug_log(f"message handling failed: {exc}")
        _update_chat_poll_timer(self)

    def _add_bid(self, name, amount, t="", bidder_key=""):
        name = _normalize_winner_text(name)
        if _countdown_is_locked(self):
            return False
        previous_top = _countdown_current_top_signature(self)
        if str(amount) != "2.0":
            result = original_add_bid(self, name, amount, t, bidder_key)
            if result:
                _restart_countdown_after_accepted_bid(self, previous_top)
            return result
        if not getattr(self, "active_item", None):
            return False
        bidder_key = str(bidder_key or name).strip() or name
        bids = self._normalize_bid_entries(self.active_item.get("bids", []))
        current_top = bids[0] if bids else None
        current_top_amount = current_top.get("amount", 0) if current_top else 0
        current_top_key = (current_top.get("bidder_key") or current_top.get("name", "")) if current_top else ""
        existing = next((b for b in bids if (b.get("bidder_key") or b["name"]) == bidder_key), None)
        if existing and existing.get("amount", 0) >= amount:
            return False
        if current_top and current_top_key != bidder_key and amount <= current_top_amount:
            return False

        prev_top_amount = current_top_amount
        prev_top_key = current_top_key
        bids = [b for b in bids if (b.get("bidder_key") or b["name"]) != bidder_key]
        bids.append({"name": name, "bidder_key": bidder_key, "amount": amount, "time": t})
        bids.sort(key=lambda b: b["amount"], reverse=True)
        self.active_item["bids"] = bids
        self._persist_bid_state_async(self.active_item, bids)
        self.auction_card.update_bids(bids)

        new_top = bids[0]
        is_new_leader = (new_top.get("bidder_key") or new_top["name"]) != prev_top_key
        if new_top["amount"] > prev_top_amount and is_new_leader and self.config.get("auto_chat_enabled", True):
            bid_name = new_top["name"]
            msg = _format_manual_chat(self, "highest", bid_name, new_top["amount"])
            if msg:
                self._queue_chat_send(msg, "최고가 갱신 안내 전송 실패")
        _restart_countdown_after_accepted_bid(self, previous_top)
        return True

    def _persist_bid_state_async(self, item, bids=None):
        row = item.get("row")
        if not row:
            return
        bid_rows = self._normalize_bid_entries(bids if bids is not None else item.get("bids", []))
        for bid in bid_rows:
            bid["name"] = _normalize_winner_text(bid.get("name", ""))
        bid_log = json.dumps(bid_rows, ensure_ascii=False)
        item["bid_log"] = bid_log
        payload = {
            "status": item.get("status", ""),
            "sold_price": item.get("sold_price", ""),
            "winner": item.get("winner", ""),
            "winner_phone": item.get("winner_phone", ""),
            "start_time": item.get("start_time", ""),
            "bid_log": bid_log,
        }
        _schedule_bid_sheet_save(self, row, payload)

    def _update_auction_title(self, current_item=None):
        """윈도우 타이틀에 현재 진행 개체만 표시."""
        try:
            base_title = "DC 밴드 경매 모니터"
            if current_item:
                name = str(current_item.get("name", "")).strip()
                company = str(current_item.get("company", "")).strip()
                current_text = f"{name}"
                if company:
                    current_text += f" ({company})"
                self.setWindowTitle(f"▶ {current_text}")
            else:
                self.setWindowTitle(base_title)
        except Exception:
            pass

    def _apply_auction_card_mode(self, item=None):
        card = getattr(self, "auction_card", None)
        if card is None:
            return
        sale_meta = _sale_item_meta(item)
        definition = sale_meta.get("definition", _SALE_MODE_DEFINITIONS["auction"])
        quiz_meta = _quiz_item_meta(item)
        is_quiz = sale_meta.get("mode") == "quiz"
        if hasattr(card, "btn_sold"):
            card.btn_sold.setText(definition.get("confirm_label", "낙찰"))
        countdown_button = getattr(card, "btn_countdown", None)
        if countdown_button is not None:
            countdown_button.setVisible(not is_quiz and bool(getattr(self, "active_item", None)))
            countdown_button.setEnabled(not is_quiz and bool(getattr(self, "active_item", None)))
        if hasattr(card, "btn_unsold"):
            card.btn_unsold.setText(definition.get("empty_label", "유찰"))
        for name in ("btn_manual_bid_add", "btn_manual_bid_edit"):
            button = getattr(card, name, None)
            if button is not None:
                button.setEnabled(not is_quiz)
        delete_button = getattr(card, "btn_manual_bid_delete", None)
        if delete_button is not None:
            delete_button.setText("정답 취소" if is_quiz else "선택 삭제")
            delete_button.setEnabled(True)
        start_label = getattr(card, "lbl_start_price", None)
        if start_label is not None:
            if is_quiz:
                start_label.setText(f"Q. {quiz_meta.get('question', '')}")
                start_label.setWordWrap(True)
                start_label.setStyleSheet(
                    "font-size:15px; font-weight:850; color:#344054; padding:8px 10px; "
                    "background:#F8FAFC; border:1px solid #EAECF0; border-radius:8px;"
                )
            else:
                start_label.setWordWrap(False)
                start_label.setStyleSheet("font-size:12px; color:#667085; font-weight:700; background:transparent;")

    def _start_auction(self, item):
        _stop_auction_countdown(self)
        sale_meta = _sale_item_meta(item)
        if sale_meta.get("mode") == "quiz":
            quiz_meta = _quiz_item_meta(item)
            missing = []
            if not quiz_meta.get("question", "").strip():
                missing.append("문제")
            if not quiz_meta.get("answer_configured"):
                missing.append("정답")
            try:
                _parse_settlement_amount(quiz_meta.get("settlement_amount"))
            except (TypeError, ValueError):
                missing.append("당첨 처리금액")
            if missing:
                self.toast.show_toast(
                    "정보 수정에서 " + ", ".join(missing) + "을(를) 입력해주세요.",
                    "warning",
                )
                return False
        try:
            _drop_pending_bid_save(self, item.get("row"))
            _prime_chat_seen_baseline(self)
            self._auction_start_mutation_seq = getattr(self, "_last_chat_mutation_seq", 0)
            _append_chat_debug_log(
                f"auction start num={item.get('num', '')} seen_keys={len(getattr(self, '_seen_msgs', []))} mutation={self._auction_start_mutation_seq}"
            )
        except Exception:
            pass
        result = original_start_auction(self, item)
        _save_active_auction_session(self, item)
        _apply_auction_card_mode(self, item)
        _update_auction_countdown_button(self)
        _update_chat_poll_timer(self)
        _update_auction_title(self, item)
        return result

    def _finalize_completed_auction_ui(self, item, status, sold_price="", winner=""):
        """Keep the local card/list state aligned with an accepted result save."""
        if status not in (_core.S_SOLD, _core.S_UNSOLD, _core.S_CANCEL):
            return

        ended_row = item.get("row")
        ended_num = item.get("num")
        target = item
        for candidate in getattr(self, "items", []) or []:
            same_row = ended_row is not None and candidate.get("row") == ended_row
            same_num = ended_row is None and candidate.get("num") == ended_num
            if same_row or same_num:
                target = candidate
                break

        # Do not overwrite a deliberate restart of the same item that happened
        # after the result was accepted.
        if target.get("status") == _core.S_ACTIVE:
            return

        target["status"] = status
        target["sold_price"] = sold_price
        target["soldPrice"] = sold_price
        target["winner"] = winner

        active = getattr(self, "active_item", None)
        if active is not None:
            active_row = active.get("row")
            active_num = active.get("num")
            is_ended_item = (
                (ended_row is not None and active_row == ended_row)
                or (ended_row is None and active_num == ended_num)
            )
            if not is_ended_item:
                return
            if active.get("status") == _core.S_ACTIVE:
                return

        self.active_item = None
        self.auction_start_time = None
        self.auction_card.set_idle()
        self._refresh_table_fast_for_items(target)
        if hasattr(self, "lbl_progress"):
            self.lbl_progress.setText("")
        _apply_auction_card_mode(self, None)
        _update_chat_poll_timer(self)
        _update_auction_title(self, None)

    def _end_auction(self, item, status, sold_price="", winner=""):
        _drop_pending_bid_save(self, item.get("row"))
        quiz_sold = _quiz_item_meta(item).get("is_quiz") and status == _core.S_SOLD
        quiz_message = ""
        auto_chat_enabled = self.config.get("auto_chat_enabled", True)
        if quiz_sold and auto_chat_enabled:
            quiz_message = (
                f"⠀⠀🟢 퀴즈 당첨 {item.get('name', '')}\n"
                f"⠀⠀ㅤ  {_quiz_display_winner(winner)}"
            )
            self.config["auto_chat_enabled"] = False
        sold_price = _normalize_money_text(sold_price)
        winner = _normalize_winner_text(winner)
        try:
            result = original_end_auction(self, item, status, sold_price, winner)
        finally:
            if quiz_sold and auto_chat_enabled:
                self.config["auto_chat_enabled"] = True
        if result and quiz_message:
            self._queue_chat_send(quiz_message, "퀴즈 당첨 안내 전송 실패")
        if result:
            _stop_auction_countdown(self)
            _clear_active_auction_session()
            if status == _core.S_SOLD:
                _queue_capture_job(self, item, sold_price, winner)
            _finalize_completed_auction_ui(self, item, status, sold_price, winner)
            # A queued signal or repaint can arrive immediately after the click.
            # Reconcile once more on the UI event loop after those callbacks.
            _core.QTimer.singleShot(
                250,
                lambda: _finalize_completed_auction_ui(self, item, status, sold_price, winner),
            )
        return result

    def _capture_current_item(self):
        """Queue the selected specimen for the main-PC PRISM capture agent."""
        card = getattr(self, "auction_card", None)
        item = getattr(card, "_viewing_item", None) or getattr(self, "active_item", None)
        if not item:
            self.toast.show_toast("캡처할 개체를 먼저 선택해 주세요.", "warning")
            return
        config = getattr(self, "config", {}) or {}
        missing = []
        if not str(config.get("capture_service_url") or "").strip():
            missing.append("서버 주소")
        if not str(config.get("capture_channel_id") or "").strip():
            missing.append("채널")
        if not str(config.get("capture_agent_token") or "").strip():
            missing.append("캡처 인증키")
        if missing:
            self.toast.show_toast(
                "설정 > 낙찰 자동 캡처에서 " + ", ".join(missing) + "을 입력해 주세요.",
                "warning",
            )
            return
        _queue_capture_job(
            self,
            item,
            item.get("sold_price") or item.get("soldPrice") or "",
            item.get("winner") or "",
            manual=True,
        )

    def _on_sold(self):
        item = getattr(self, "active_item", None)
        if not item or not _quiz_item_meta(item).get("is_quiz"):
            return original_on_sold(self)
        bids = self._normalize_bid_entries(item.get("bids", []))
        if not bids:
            self.toast.show_toast("아직 정답자가 없습니다.", "warning")
            return
        top = bids[0]
        quiz_meta = _quiz_item_meta(item)
        try:
            settlement_amount = _settlement_amount_text(quiz_meta.get("settlement_amount"))
        except (TypeError, ValueError):
            self.toast.show_toast("당첨 처리금액이 설정되지 않았습니다. 정보 수정에서 입력해주세요.", "warning")
            return
        item_ref = item
        if self._end_auction(
            item_ref,
            _core.S_SOLD,
            sold_price=settlement_amount,
            winner=top.get("name", ""),
        ):
            self.toast.show_toast(
                f"#{item_ref.get('num', '')} {item_ref.get('name', '')} 당첨! ({top.get('name', '')})",
                "success",
            )
            self._maybe_auto_print_label(item_ref)

    def _discard_thread(self, thread):
        try:
            self._niimbot_threads.remove(thread)
        except (AttributeError, ValueError):
            pass

    def _start_next_label_job(self):
        if getattr(self, "_label_print_jobs", 0) > 0:
            return
        pending = getattr(self, "_pending_label_prints", [])
        if not pending:
            return
        job_id, start_message = pending.pop(0)
        _core.QTimer.singleShot(150, lambda: self._start_label_print(None, start_message, job_id=job_id))

    def _make_label_spool_job(self, item):
        label_ctx = self._build_label_print_context(item)
        cfg = getattr(self, "config", {}) or {}
        payload = {
            "num": item.get("num", ""),
            "item_name": item.get("name", ""),
            "winner_name": label_ctx["line2"],
            "sold_price": label_ctx["price_text"],
            "winner_phone": label_ctx["line3"],
            "company": item.get("company", ""),
            "mac_address": (
                cfg.get("label_printer_mac")
                or cfg.get("niimbot_mac")
                or cfg.get("printer_mac")
                or ""
            ),
            "port": (
                cfg.get("label_printer_port")
                or cfg.get("niimbot_port")
                or cfg.get("printer_port")
                or ""
            ),
            "density": _as_int(cfg.get("label_density"), 3),
            "ble_scan_timeout": _as_float(cfg.get("label_ble_scan_timeout"), 1.0),
            "font_key": cfg.get("label_font", "pretendard"),
            "label_layout": cfg.get("label_layout", "auction"),
        }
        now = _now_text()
        job = {
            "id": f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}",
            "created_at": now,
            "updated_at": now,
            "status": "queued",
            "attempts": 0,
            "last_error": "",
            "payload": payload,
        }
        _LABEL_SPOOL.append(job, max_jobs=300)
        return job

    def _get_label_spool_job(self, job_id):
        return _LABEL_SPOOL.find(job_id)

    def _update_label_spool_job(self, job_id, **updates):
        return _LABEL_SPOOL.update(job_id, **updates)

    def _install_label_reprint_button(self):
        try:
            top_bar = self.findChild(_core.QWidget, "topBar")
            layout = top_bar.layout() if top_bar else None
            if layout is None:
                return
            if getattr(self, "btn_label_reprint", None):
                return
            btn = _core.QPushButton("라벨 재출력")
            btn.setToolTip("실패했거나 최근 출력한 낙찰 라벨을 다시 출력")
            btn.setCursor(_core.Qt.PointingHandCursor)
            btn.setStyleSheet(
                """
                QPushButton {
                    background: rgba(255,255,255,0.14); color: #FFFFFF;
                    border: 1px solid rgba(255,255,255,0.22);
                    border-radius: 4px; padding: 6px 10px;
                    font-size: 11px; font-weight: 700; min-height: 24px;
                }
                QPushButton:hover { background: rgba(255,255,255,0.24); }
                """
            )
            btn.clicked.connect(lambda: self._open_label_reprint_dialog())
            layout.insertWidget(max(0, layout.count() - 1), btn)
            self.btn_label_reprint = btn
        except Exception as exc:
            print(f"[LabelSpool] reprint button install failed: {exc}")

    def _open_label_reprint_dialog(self):
        spool = _LABEL_SPOOL.load()
        jobs = [
            job
            for job in reversed(spool.get("jobs", []))
            if job.get("status") in {"failed", "done", "queued"}
        ][:30]
        if not jobs:
            self.toast.show_toast("재출력할 라벨 기록이 없습니다.", "warning")
            return

        labels = [label_display_text(job) for job in jobs]
        selected, ok = _core.QInputDialog.getItem(
            self,
            "라벨 재출력",
            "다시 출력할 라벨을 선택하세요:",
            labels,
            0,
            False,
        )
        if not ok or not selected:
            return
        try:
            job = jobs[labels.index(selected)]
        except ValueError:
            return
        self._retry_label_job(job.get("id"))

    def _retry_label_job(self, job_id):
        if not job_id:
            return
        job = self._update_label_spool_job(job_id, status="queued", last_error="")
        if not job:
            self.toast.show_toast("재출력할 라벨 기록을 찾지 못했습니다.", "error")
            return
        if getattr(self, "_label_print_jobs", 0) > 0:
            self._pending_label_prints.append((job_id, "라벨 재출력을 대기열에 추가했습니다."))
            self.toast.show_toast("라벨 재출력을 대기열에 추가했습니다.", "info")
            return
        self._start_label_print(None, "라벨 재출력 시작...", job_id=job_id)

    def _maybe_auto_print_label(self, item):
        if not item:
            return
        if not (getattr(self, "config", {}) or {}).get("auto_label_print_enabled", True):
            return
        status = str(item.get("status", "")).strip()
        if status not in {_core.S_SOLD, _core.S_UNSOLD}:
            return
        key = (
            item.get("row", ""),
            item.get("num", ""),
            status,
            item.get("sold_price", ""),
            item.get("winner", ""),
        )
        if key == getattr(self, "_last_auto_label_key", None):
            return
        self._last_auto_label_key = key
        self._start_label_print(item, "라벨 인쇄 시작...")

    def _append_label_print_log(self, message):
        try:
            log_dir = os.path.join(APP_DIR, "print_outputs")
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, "label_print_worker.log")
            stamp = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"\n[{stamp}] {message}\n")
        except Exception:
            pass

    def _short_label_error(message):
        message = str(message or "").strip()
        if not message:
            return "알 수 없는 오류"
        lines = [line.strip() for line in message.splitlines() if line.strip()]
        message = lines[-1] if lines else message
        if len(message) > 140:
            message = message[:140] + "..."
        return message

    def _finish_label_job(self, thread, ok, message=""):
        if getattr(thread, "_dc_label_finished", False):
            return
        thread._dc_label_finished = True
        _discard_thread(self, thread)
        job_id = getattr(thread, "_dc_label_job_id", "")
        if job_id:
            if ok:
                self._update_label_spool_job(job_id, status="done", last_error="")
            else:
                self._update_label_spool_job(job_id, status="failed", last_error=str(message or ""))
        self._label_print_current_job_id = None
        self._label_print_jobs = max(0, getattr(self, "_label_print_jobs", 0) - 1)
        _update_chat_poll_timer(self)
        if ok:
            self.toast.show_toast("라벨 인쇄 완료!", "success")
        else:
            self.toast.show_toast(
                f"라벨 인쇄 실패: {_short_label_error(message)} / 상단 라벨 재출력에서 다시 출력 가능",
                "error",
            )
        _start_next_label_job(self)

    def _start_label_print(self, item, start_message, job_id=None):
        if job_id:
            job_record = self._get_label_spool_job(job_id)
            if not job_record:
                self.toast.show_toast("라벨 출력 기록을 찾지 못했습니다.", "error")
                return
        else:
            if not item:
                self.toast.show_toast("선택한 개체가 없습니다.", "warning")
                return
            job_record = self._make_label_spool_job(dict(item))
            job_id = job_record["id"]

        if getattr(self, "_label_print_jobs", 0) > 0:
            self._pending_label_prints.append((job_id, start_message))
            self._update_label_spool_job(job_id, status="queued")
            self.toast.show_toast("라벨 인쇄 대기열에 추가했습니다.", "info")
            return

        self.toast.show_toast(start_message, "info")
        self._update_label_spool_job(
            job_id,
            status="printing",
            attempts=int(job_record.get("attempts", 0) or 0) + 1,
        )
        job = dict(job_record.get("payload", {}))
        num = job.get("num", "")
        cfg = getattr(self, "config", {}) or {}
        timeout_sec = max(10.0, _as_float(cfg.get("label_print_timeout_sec"), 35.0))
        retries = max(0, min(3, _as_int(cfg.get("label_print_retries"), 1)))
        retry_delay = max(0.0, _as_float(cfg.get("label_print_retry_delay_sec"), 1.5))
        worker_path = os.path.join(APP_DIR, "label_print_worker.py")

        class LabelPrintThread(_core.QThread):
            sig_done = _core.pyqtSignal()
            sig_err = _core.pyqtSignal(str)

            def _read_worker_error(self, stdout, stderr, fallback):
                combined = "\n".join(part for part in (stdout, stderr) if part)
                for line in reversed(combined.splitlines()):
                    line = line.strip()
                    if not line.startswith("{"):
                        continue
                    try:
                        payload = json.loads(line)
                    except Exception:
                        continue
                    if payload.get("error"):
                        return str(payload.get("error"))
                return fallback or combined.strip() or "프린터 작업 실패"

            def run(self):
                job_path = ""
                try:
                    if not os.path.exists(worker_path):
                        self.sig_err.emit("라벨 출력 worker 파일이 없습니다.")
                        return

                    last_error = ""
                    for attempt in range(retries + 1):
                        job_path = os.path.join(
                            tempfile.gettempdir(),
                            f"dc_label_{os.getpid()}_{uuid.uuid4().hex}.json",
                        )
                        with open(job_path, "w", encoding="utf-8") as f:
                            json.dump(job, f, ensure_ascii=False)

                        env = os.environ.copy()
                        env["PYTHONUTF8"] = "1"
                        env["PYTHONIOENCODING"] = "utf-8"
                        cmd = [sys.executable, worker_path, "--job-json", job_path]
                        started = time.perf_counter()
                        try:
                            result = subprocess.run(
                                cmd,
                                cwd=APP_DIR,
                                env=env,
                                capture_output=True,
                                text=True,
                                encoding="utf-8",
                                errors="replace",
                                timeout=timeout_sec,
                            )
                            elapsed = time.perf_counter() - started
                            _append_label_print_log(
                                self,
                                (
                                    f"job num={num} attempt={attempt + 1}/{retries + 1} "
                                    f"exit={result.returncode} elapsed={elapsed:.1f}s\n"
                                    f"stdout:\n{result.stdout}\n"
                                    f"stderr:\n{result.stderr}"
                                ),
                            )
                            if result.returncode == 0:
                                self.sig_done.emit()
                                return
                            last_error = self._read_worker_error(
                                result.stdout,
                                result.stderr,
                                f"worker exit {result.returncode}",
                            )
                        except subprocess.TimeoutExpired as exc:
                            last_error = f"{int(timeout_sec)}초 동안 응답이 없어 라벨 출력을 중단했습니다."
                            _append_label_print_log(
                                self,
                                (
                                    f"job num={num} attempt={attempt + 1}/{retries + 1} "
                                    f"timeout={timeout_sec}s\n"
                                    f"stdout:\n{exc.stdout or ''}\n"
                                    f"stderr:\n{exc.stderr or ''}"
                                ),
                            )
                        finally:
                            try:
                                os.remove(job_path)
                            except Exception:
                                pass
                            job_path = ""

                        if attempt < retries:
                            time.sleep(retry_delay)

                    self.sig_err.emit(last_error or "프린터 연결 또는 인쇄에 실패했습니다.")
                except Exception as exc:
                    self.sig_err.emit(str(exc))
                finally:
                    if job_path:
                        try:
                            os.remove(job_path)
                        except Exception:
                            pass

        self._label_print_jobs = getattr(self, "_label_print_jobs", 0) + 1
        self._label_print_current_job_id = job_id
        _update_chat_poll_timer(self)
        thread = LabelPrintThread()
        thread._dc_label_finished = False
        thread._dc_label_job_id = job_id
        self._niimbot_threads.append(thread)
        thread.finished.connect(lambda thr=thread: _discard_thread(self, thr))
        thread.sig_done.connect(lambda thr=thread: _finish_label_job(self, thr, True))
        thread.sig_err.connect(lambda err, thr=thread: _finish_label_job(self, thr, False, err))
        thread.start()

    MainWindow.__init__ = __init__
    MainWindow._chat_poll_interval_ms = _chat_poll_interval_ms
    MainWindow._update_chat_poll_timer = _update_chat_poll_timer
    MainWindow._chat_message_seen_key = _chat_message_seen_key
    MainWindow._prime_chat_seen_baseline = _prime_chat_seen_baseline
    MainWindow._make_label_spool_job = _make_label_spool_job
    MainWindow._get_label_spool_job = _get_label_spool_job
    MainWindow._update_label_spool_job = _update_label_spool_job
    MainWindow._open_label_reprint_dialog = _open_label_reprint_dialog
    MainWindow._retry_label_job = _retry_label_job
    MainWindow._on_chat_poll_done = _on_chat_poll_done
    MainWindow._on_chat_send_done = _on_chat_send_done
    MainWindow._on_connect_done_inner = _on_connect_done_inner
    MainWindow._normalize_bid_entries = _normalize_bid_entries
    MainWindow._persist_bid_state_async = _persist_bid_state_async
    MainWindow._prompt_manual_bid = _prompt_manual_bid
    MainWindow._record_manual_bid = _record_manual_bid
    MainWindow._record_quiz_answer = _record_quiz_answer
    MainWindow._send_current_highest_chat = _send_current_highest_chat
    MainWindow._send_current_winner_chat = _send_current_winner_chat
    MainWindow._send_current_auction_status_chat = _send_current_auction_status_chat
    MainWindow._send_manual_highest_chat = _send_current_highest_chat
    MainWindow._send_manual_winner_chat = _send_current_winner_chat
    MainWindow._send_highest = _send_current_highest_chat
    MainWindow._countdown_current_bids = _countdown_current_bids
    MainWindow._countdown_current_top_signature = _countdown_current_top_signature
    MainWindow._countdown_is_locked = _countdown_is_locked
    MainWindow._update_auction_countdown_button = _update_auction_countdown_button
    MainWindow._set_auction_countdown_state = _set_auction_countdown_state
    MainWindow._init_auction_countdown = _init_auction_countdown
    MainWindow._stop_auction_countdown = _stop_auction_countdown
    MainWindow._begin_auction_countdown = _begin_auction_countdown
    MainWindow._advance_auction_countdown = _advance_auction_countdown
    MainWindow._lock_auction_bidding = _lock_auction_bidding
    MainWindow._confirm_auction_lock_boundary = _confirm_auction_lock_boundary
    MainWindow._record_locked_late_bid = _record_locked_late_bid
    MainWindow._approve_manual_bid_and_resume = _approve_manual_bid_and_resume
    MainWindow._on_auction_countdown_action = _on_auction_countdown_action
    MainWindow._restart_countdown_after_accepted_bid = _restart_countdown_after_accepted_bid
    MainWindow._refresh_table = _refresh_table_sorted
    MainWindow._refresh_table_fast_for_items = _refresh_table_fast_compact
    MainWindow._start_auction = _start_auction
    MainWindow._end_auction = _end_auction
    MainWindow._capture_broadcast_photo = _capture_current_item
    MainWindow._on_sold = _on_sold
    MainWindow._add_bid = _add_bid
    MainWindow._maybe_auto_print_label = _maybe_auto_print_label
    MainWindow._start_label_print = _start_label_print


def _patch_parent_selector():
    ItemDetailDialog = _core.ItemDetailDialog

    def _parent_text(value):
        return str(value or "").strip()

    def _parent_matches(parent, needle):
        if not needle:
            return True
        haystack = " ".join(
            _parent_text(parent.get(key))
            for key in ("id", "name", "company", "morph", "gender", "memo", "date")
        ).lower()
        return needle.lower() in haystack

    def _parent_score(parent, role):
        gender = _parent_text(parent.get("gender"))
        if role == "sire" and gender in {"수컷", "M", "male", "Male"}:
            return 0
        if role == "dam" and gender in {"암컷", "F", "female", "Female"}:
            return 0
        return 1

    class ParentSearchDialog(_core.QDialog):
        def __init__(self, mw, item, parents, role, parent=None):
            super().__init__(parent)
            self.mw = mw
            self.item = item
            self.parents = list(parents or [])
            self.role = role
            self.sheets = getattr(mw, "sheets", None) or getattr(mw, "sheets_manager", None)
            self.selected_parent = None
            self.selected_pid = ""
            self.filtered = []

            role_name = "부개체" if role == "sire" else "모개체"
            self.setWindowTitle(f"{role_name} 선택")
            self.setMinimumSize(860, 620)
            self.setStyleSheet(
                """
                QDialog { background: #FFFFFF; }
                QLineEdit, QComboBox {
                    background: #FFFFFF; color: #191F28;
                    border: 1px solid #D1D5DB; border-radius: 6px;
                    padding: 8px 10px; font-size: 13px;
                }
                QTableWidget {
                    background: #FFFFFF; border: 1px solid #E5E8EB;
                    gridline-color: #F2F4F6; selection-background-color: #E8F1FF;
                    selection-color: #191F28;
                }
                QHeaderView::section {
                    background: #F8FAFC; color: #4E5968; border: none;
                    border-bottom: 1px solid #D1D5DB; padding: 8px;
                    font-size: 12px; font-weight: 800;
                }
                """
            )

            root = _core.QVBoxLayout(self)
            root.setContentsMargins(20, 18, 20, 18)
            root.setSpacing(12)

            header = _core.QHBoxLayout()
            title = _core.QLabel(f"{role_name} 선택")
            title.setStyleSheet("font-size: 18px; font-weight: 900; color: #191F28;")
            self.lbl_count = _core.QLabel("")
            self.lbl_count.setStyleSheet("font-size: 12px; font-weight: 700; color: #6B7280;")
            btn_close = _core.QPushButton("×")
            btn_close.setFixedSize(28, 28)
            btn_close.setCursor(_core.Qt.PointingHandCursor)
            btn_close.setStyleSheet("border: none; font-size: 20px; color: #8B95A1;")
            btn_close.clicked.connect(self.reject)
            header.addWidget(title)
            header.addWidget(self.lbl_count)
            header.addStretch()
            header.addWidget(btn_close)
            root.addLayout(header)

            filters = _core.QHBoxLayout()
            self.search = _core.QLineEdit()
            self.search.setPlaceholderText("이름, 업체, 모프, 메모, ID로 검색")
            self.search.textChanged.connect(lambda _text: self._populate())
            self.gender_filter = _core.QComboBox()
            self.gender_filter.addItems(["전체", "수컷", "암컷", "미상"])
            self.gender_filter.currentTextChanged.connect(lambda _text: self._populate())
            btn_clear_search = _core.QPushButton("검색 지우기")
            btn_clear_search.setCursor(_core.Qt.PointingHandCursor)
            btn_clear_search.clicked.connect(self.search.clear)
            filters.addWidget(self.search, 1)
            filters.addWidget(self.gender_filter)
            filters.addWidget(btn_clear_search)
            root.addLayout(filters)

            self.lbl_current = _core.QLabel(self._current_text())
            self.lbl_current.setStyleSheet(
                "font-size: 12px; color: #4E5968; background: #F8FAFC; "
                "border: 1px solid #E5E8EB; border-radius: 6px; padding: 8px 10px;"
            )
            root.addWidget(self.lbl_current)

            self.table = _core.QTableWidget(0, 6)
            self.table.setHorizontalHeaderLabels(["이름", "업체", "성별", "모프/특징", "메모", "ID"])
            self.table.verticalHeader().hide()
            self.table.setSelectionBehavior(_core.QAbstractItemView.SelectRows)
            self.table.setSelectionMode(_core.QAbstractItemView.SingleSelection)
            self.table.setEditTriggers(_core.QAbstractItemView.NoEditTriggers)
            self.table.setAlternatingRowColors(True)
            self.table.itemSelectionChanged.connect(self._sync_selection)
            self.table.cellDoubleClicked.connect(lambda _r, _c: self._accept_selected())
            hdr = self.table.horizontalHeader()
            hdr.setSectionResizeMode(0, _core.QHeaderView.Stretch)
            hdr.setSectionResizeMode(1, _core.QHeaderView.ResizeToContents)
            hdr.setSectionResizeMode(2, _core.QHeaderView.ResizeToContents)
            hdr.setSectionResizeMode(3, _core.QHeaderView.Stretch)
            hdr.setSectionResizeMode(4, _core.QHeaderView.Stretch)
            hdr.setSectionResizeMode(5, _core.QHeaderView.ResizeToContents)
            root.addWidget(self.table, 1)

            buttons = _core.QHBoxLayout()
            self.btn_unset = _core.QPushButton(f"{role_name} 비우기")
            self.btn_unset.clicked.connect(self._unset)
            self.btn_manage = _core.QPushButton("부모개체 관리")
            self.btn_manage.clicked.connect(self._open_register)
            self.btn_cancel = _core.QPushButton("취소")
            self.btn_cancel.clicked.connect(self.reject)
            self.btn_select = _core.QPushButton("선택")
            self.btn_select.setDefault(True)
            self.btn_select.clicked.connect(self._accept_selected)
            for btn in (self.btn_unset, self.btn_manage, self.btn_cancel, self.btn_select):
                btn.setCursor(_core.Qt.PointingHandCursor)
                btn.setFixedHeight(40)
            self.btn_select.setStyleSheet(
                "QPushButton { background: #093687; color: white; border: none; "
                "border-radius: 6px; font-weight: 900; }"
            )
            buttons.addWidget(self.btn_unset)
            buttons.addWidget(self.btn_manage)
            buttons.addStretch()
            buttons.addWidget(self.btn_cancel)
            buttons.addWidget(self.btn_select)
            root.addLayout(buttons)

            self._populate()

        def _current_id(self):
            if self.role == "sire":
                return self.item.get("sire_id") or self.item.get("sireId") or ""
            return self.item.get("dam_id") or self.item.get("damId") or ""

        def _current_text(self):
            pid = self._current_id()
            role_name = "현재 부개체" if self.role == "sire" else "현재 모개체"
            if not pid:
                return f"{role_name}: 미지정"
            parent = next((p for p in self.parents if p.get("id") == pid), None)
            if not parent:
                return f"{role_name}: {pid}"
            bits = [
                _parent_text(parent.get("name")),
                _parent_text(parent.get("company")),
                _parent_text(parent.get("morph")),
            ]
            return f"{role_name}: " + " / ".join(bit for bit in bits if bit) + f" ({pid})"

        def _make_item(self, text, parent, column):
            item = _core.QTableWidgetItem(_parent_text(text))
            item.setData(_core.Qt.UserRole, parent)
            if column == 0:
                item.setFont(_core.QFont("Pretendard", 10, _core.QFont.Bold))
            return item

        def _populate(self):
            needle = self.search.text().strip()
            gender_filter = self.gender_filter.currentText()
            rows = [p for p in self.parents if _parent_matches(p, needle)]
            if gender_filter != "전체":
                rows = [p for p in rows if _parent_text(p.get("gender")) == gender_filter]
            rows.sort(key=lambda p: (_parent_score(p, self.role), _parent_text(p.get("name")), _parent_text(p.get("company"))))
            self.filtered = rows
            self.table.setRowCount(len(rows))
            current_id = self._current_id()
            select_row = -1
            for row, p in enumerate(rows):
                values = [
                    p.get("name", ""),
                    p.get("company", ""),
                    p.get("gender", ""),
                    p.get("morph", ""),
                    p.get("memo", ""),
                    p.get("id", ""),
                ]
                for col, value in enumerate(values):
                    self.table.setItem(row, col, self._make_item(value, p, col))
                self.table.setRowHeight(row, 34)
                if p.get("id") == current_id:
                    select_row = row
            self.lbl_count.setText(f"{len(rows)}개 표시 / 전체 {len(self.parents)}개")
            if select_row >= 0:
                self.table.selectRow(select_row)
                self.table.scrollToItem(self.table.item(select_row, 0))
            elif rows:
                self.table.selectRow(0)

        def _sync_selection(self):
            selected = self.table.selectedItems()
            if not selected:
                self.selected_parent = None
                self.selected_pid = ""
                return
            parent = selected[0].data(_core.Qt.UserRole)
            self.selected_parent = parent
            self.selected_pid = parent.get("id", "") if parent else ""

        def _apply_parent(self, pid, parent):
            photo = parent.get("photo", "") if parent else ""
            if self.role == "sire":
                self.item["sire_id"] = pid
                self.item["sireId"] = pid
                self.item["photoSire"] = photo
            else:
                self.item["dam_id"] = pid
                self.item["damId"] = pid
                self.item["photoDam"] = photo

            row = self.item.get("row")
            writer = getattr(self.sheets, "write_parent_ids", None) or getattr(self.sheets, "update_parent_ids", None)
            if row and self.sheets and getattr(self.sheets, "write_enabled", False) and writer:
                sire_id = self.item.get("sire_id") or self.item.get("sireId") or ""
                dam_id = self.item.get("dam_id") or self.item.get("damId") or ""
                def _write_parent_ids():
                    try:
                        writer(row, sire_id, dam_id)
                    except Exception as exc:
                        print(f"[ParentSelector] parent id write failed: {exc}")
                import threading
                threading.Thread(target=_write_parent_ids, daemon=True).start()

        def _accept_selected(self):
            self._sync_selection()
            if not self.selected_parent:
                if self.table.rowCount() == 0:
                    _core.QMessageBox.information(self, "부모개체 없음", "검색 결과가 없습니다.")
                return
            self._apply_parent(self.selected_pid, self.selected_parent)
            self.accept()

        def _unset(self):
            self._apply_parent("", None)
            self.accept()

        def _open_register(self):
            dlg = _core.ParentRegisterDialog(self.sheets, self.parents, self)
            if dlg.exec_() == _core.QDialog.Accepted:
                self.parents = list(getattr(getattr(self.mw, "auction_card", None), "_parent_cache", self.parents) or self.parents)
                self.lbl_current.setText(self._current_text())
                self._populate()

    def _open_parent_picker(self, p_type, slot_box):
        parents = getattr(self.mw.auction_card, "_parent_cache", [])
        if not parents and hasattr(self.mw.auction_card, "_load_parent_combos"):
            self.mw.auction_card._load_parent_combos(self.item)
            parents = getattr(self.mw.auction_card, "_parent_cache", [])

        dlg = ParentSearchDialog(self.mw, self.item, parents, p_type, self)
        if dlg.exec_() != _core.QDialog.Accepted:
            return

        if p_type == "sire":
            pid = self.item.get("sire_id") or self.item.get("sireId") or ""
            self._set_parent_keys(sire_id=pid)
            slot_box.set_url(self.item.get("photoSire", ""))
        else:
            pid = self.item.get("dam_id") or self.item.get("damId") or ""
            self._set_parent_keys(dam_id=pid)
            slot_box.set_url(self.item.get("photoDam", ""))

    ItemDetailDialog._open_parent_picker = _open_parent_picker
    _core.ParentSearchDialog = ParentSearchDialog


def _patch_item_detail_popup():
    ItemDetailPopup = _core.ItemDetailPopup
    original_init = ItemDetailPopup.__init__

    def _checklist_values(raw):
        values = {}
        for part in str(raw or "").split("|"):
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            values[key.strip()] = value.strip()
        return values

    def __init__(self, parent, item, parent_cache=None):
        original_init(self, parent, item, parent_cache)
        sheet = self.findChild(_core.QWidget, "bsSheet")
        if sheet is None or sheet.layout() is None:
            return

        start_button = next(
            (button for button in sheet.findChildren(_core.QPushButton) if button.text() == "경매 시작"),
            None,
        )
        edit_button = next(
            (button for button in sheet.findChildren(_core.QPushButton) if button.text() == "정보 수정"),
            None,
        )
        if start_button is None or edit_button is None:
            return

        sale_meta = _sale_item_meta(item)
        start_button.setText(sale_meta.get("definition", {}).get("start_label", "경매 시작"))

        keep = {start_button, edit_button}

        def _clear_layout(layout):
            while layout.count():
                child = layout.takeAt(0)
                child_layout = child.layout()
                widget = child.widget()
                if child_layout is not None:
                    _clear_layout(child_layout)
                elif widget is not None:
                    if widget in keep:
                        widget.setParent(sheet)
                    else:
                        widget.hide()
                        widget.deleteLater()

        layout = sheet.layout()
        _clear_layout(layout)
        sheet.setFixedHeight(244)
        sheet.setStyleSheet(
            "QWidget#bsSheet { background:#FFFFFF; border:1px solid #DDE3EA; "
            "border-top-left-radius:14px; border-top-right-radius:14px; }"
        )
        layout.setContentsMargins(24, 10, 24, 18)
        layout.setSpacing(10)

        handle_row = _core.QHBoxLayout()
        handle = _core.QFrame(sheet)
        handle.setFixedSize(42, 4)
        handle.setStyleSheet("background:#D0D5DD; border:none; border-radius:2px;")
        handle_row.addStretch(1)
        handle_row.addWidget(handle)
        handle_row.addStretch(1)
        layout.addLayout(handle_row)

        heading = _core.QWidget(sheet)
        heading_layout = _core.QVBoxLayout(heading)
        heading_layout.setContentsMargins(0, 0, 0, 0)
        heading_layout.setSpacing(2)
        title = _core.QLabel(f"#{item.get('num', '')}  {item.get('name', '')}", heading)
        title.setStyleSheet("font-size:18px; font-weight:900; color:#191F28; background:transparent;")
        company = _core.QLabel(str(item.get("company") or "업체 미입력"), heading)
        company.setStyleSheet("font-size:11px; font-weight:700; color:#8B95A1; background:transparent;")
        heading_layout.addWidget(title)
        heading_layout.addWidget(company)
        layout.addWidget(heading)

        checklist = _checklist_values(item.get("checklist", ""))
        gender_text = {"M": "수컷", "F": "암컷", "U": "미구분"}.get(
            checklist.get("gender", "U"), checklist.get("gender", "미구분")
        )
        weight_text = checklist.get("weight") or "-"
        if weight_text != "-" and not weight_text.lower().endswith("g"):
            weight_text += "g"

        summary = _core.QFrame(sheet)
        summary.setObjectName("popupSummaryCard")
        summary.setFixedHeight(72)
        summary.setStyleSheet(
            "QFrame#popupSummaryCard { background:#F8FAFC; border:1px solid #EAECF0; border-radius:8px; }"
        )
        summary_layout = _core.QHBoxLayout(summary)
        summary_layout.setContentsMargins(14, 9, 14, 9)
        summary_layout.setSpacing(20)

        def _summary_field(label_text, value_text):
            field = _core.QWidget(summary)
            field_layout = _core.QVBoxLayout(field)
            field_layout.setContentsMargins(0, 0, 0, 0)
            field_layout.setSpacing(3)
            field_label = _core.QLabel(label_text, field)
            field_label.setStyleSheet("font-size:10px; color:#8B95A1; font-weight:700; background:transparent;")
            value = _core.QLabel(str(value_text or "-"), field)
            value.setStyleSheet("font-size:13px; color:#344054; font-weight:800; background:transparent;")
            field_layout.addWidget(field_label)
            field_layout.addWidget(value)
            return field

        summary_layout.addWidget(_summary_field("성별", gender_text), 1)
        summary_layout.addWidget(_summary_field("무게", weight_text), 1)
        summary_layout.addWidget(_summary_field("비고", item.get("note") or "-"), 4)
        layout.addWidget(summary)

        actions = _core.QHBoxLayout()
        actions.setSpacing(10)
        actions.addStretch(1)
        start_button.setFixedSize(180, 48)
        edit_button.setFixedSize(180, 48)
        start_button.setStyleSheet(
            "QPushButton { background:#D64B32; color:white; border:none; border-radius:8px; "
            "font-size:13px; font-weight:900; } QPushButton:hover { background:#BE3F2A; }"
            "QPushButton:disabled { background:#E4E7EC; color:#98A2B3; }"
        )
        edit_button.setStyleSheet(
            "QPushButton { background:#173E8F; color:white; border:none; border-radius:8px; "
            "font-size:13px; font-weight:900; } QPushButton:hover { background:#234F9C; }"
        )
        actions.addWidget(start_button)
        actions.addWidget(edit_button)
        layout.addLayout(actions)

    ItemDetailPopup.__init__ = __init__


def _patch_item_detail_layout():
    ItemDetailDialog = _core.ItemDetailDialog
    original_init = ItemDetailDialog.__init__
    original_on_save = ItemDetailDialog._on_save

    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)

        root = self.layout()
        if root is None:
            return

        scroll = self.findChild(_core.QScrollArea)
        if scroll is None:
            return

        scroll_index = root.indexOf(scroll)
        root.removeWidget(scroll)
        scroll.hide()
        self._legacy_detail_scroll = scroll

        self.setObjectName("detailEditorDialog")
        self.setStyleSheet("QDialog#detailEditorDialog { background:#F2F4F7; }")
        self.setMinimumSize(980, 780)
        self.resize(1120, 900)
        root.setContentsMargins(24, 18, 24, 18)
        root.setSpacing(14)

        header_layout = root.itemAt(0).layout() if root.count() else None
        if header_layout is not None and header_layout.count() >= 2:
            eyebrow = header_layout.itemAt(0).widget()
            title_label = header_layout.itemAt(1).widget()
            if eyebrow is not None:
                eyebrow.hide()
            if title_label is not None:
                title_label.setStyleSheet(
                    "font-size:18px; color:#191F28; font-weight:900; background:transparent;"
                )

        panel = _core.QWidget(self)
        panel_layout = _core.QVBoxLayout(panel)
        panel_layout.setContentsMargins(0, 0, 0, 0)
        panel_layout.setSpacing(14)

        field_label_style = "font-size:11px; color:#667085; font-weight:700; padding:0 0 2px 1px;"

        def labeled_field(label_text, widget, height=40, align_left=False):
            box = _core.QWidget(panel)
            box_layout = _core.QVBoxLayout(box)
            box_layout.setContentsMargins(0, 0, 0, 0)
            box_layout.setSpacing(5)
            label = _core.QLabel(label_text, box)
            label.setStyleSheet(field_label_style)
            box_layout.addWidget(label)
            widget.setParent(box)
            if height:
                widget.setFixedHeight(height)
            if align_left:
                box_layout.addWidget(widget, 0, _core.Qt.AlignLeft | _core.Qt.AlignVCenter)
            else:
                widget.setSizePolicy(_core.QSizePolicy.Expanding, _core.QSizePolicy.Fixed)
                box_layout.addWidget(widget)
            return box

        basic_card = _core.QFrame(panel)
        basic_card.setObjectName("basicInfoCard")
        basic_card.setFixedHeight(116)
        basic_card.setStyleSheet(
            "QFrame#basicInfoCard { background:#FFFFFF; border:1px solid #E4E7EC; border-radius:10px; }"
        )
        basic_layout = _core.QVBoxLayout(basic_card)
        basic_layout.setContentsMargins(16, 12, 16, 14)
        basic_layout.setSpacing(8)
        basic_title = _core.QLabel("기본 정보", basic_card)
        basic_title.setStyleSheet("font-size:13px; color:#344054; font-weight:900; background:transparent;")
        basic_layout.addWidget(basic_title)

        basic_row = _core.QHBoxLayout()
        basic_row.setSpacing(12)
        basic_row.addWidget(labeled_field("업체명", self.f_company), 3)
        basic_row.addWidget(labeled_field("개체명", self.f_name), 2)
        basic_row.addWidget(labeled_field("비고", self.f_note), 4)
        basic_layout.addLayout(basic_row)

        quiz_meta = _quiz_item_meta(getattr(self, "item", {}))
        sale_meta = _sale_item_meta(getattr(self, "item", {}))
        competition_mode = _competition_mode(getattr(self, "item", {}))
        visibility_mode = _visibility_mode(getattr(self, "item", {}))
        quiz_row = _core.QHBoxLayout()
        quiz_row.setSpacing(12)
        mode_combo = _core.QComboBox(basic_card)
        for mode_key, definition in _SALE_MODE_DEFINITIONS.items():
            mode_combo.addItem(definition.get("label", mode_key), mode_key)
        mode_index = mode_combo.findData(sale_meta.get("mode", "auction"))
        mode_combo.setCurrentIndex(max(0, mode_index))
        mode_combo.setFixedHeight(40)
        competition_input = _core.QLineEdit(
            _COMPETITION_MODE_LABELS.get(competition_mode, competition_mode),
            basic_card,
        )
        competition_input.setReadOnly(True)
        competition_input.setToolTip("대진 방식은 토너먼트 편성 화면에서 결정됩니다.")
        competition_input.setFixedHeight(40)
        visibility_combo = _core.QComboBox(basic_card)
        visibility_combo.addItem(
            "자동 (업체명 숨김)" if competition_mode == "tournament" else "자동 (업체명 공개)",
            "inherit",
        )
        visibility_combo.addItem(_VISIBILITY_MODE_DEFINITIONS["public"], "public")
        visibility_combo.addItem(_VISIBILITY_MODE_DEFINITIONS["blind"], "blind")
        visibility_index = visibility_combo.findData(visibility_mode)
        visibility_combo.setCurrentIndex(max(0, visibility_index))
        visibility_combo.setFixedHeight(40)
        visibility_combo.setToolTip("자동은 단독·퀴즈의 업체명을 공개하고, 토너먼트 경매 중에는 숨깁니다.")
        question_input = _core.QLineEdit(quiz_meta.get("question", ""), basic_card)
        question_input.setPlaceholderText("화면에 표시할 문제")
        question_input.setClearButtonEnabled(True)
        answer_input = _core.QLineEdit(quiz_meta.get("answer", ""), basic_card)
        answer_input.setPlaceholderText(
            "정답 설정됨 · 변경할 때만 새 정답 입력"
            if quiz_meta.get("answer_digest")
            else "채팅에서 정확히 일치해야 할 정답"
        )
        answer_input.setClearButtonEnabled(True)
        settlement_input = _core.QDoubleSpinBox(basic_card)
        settlement_input.setDecimals(2)
        settlement_input.setRange(0, 999999)
        settlement_input.setSingleStep(1)
        settlement_input.setSuffix(" 만원")
        settlement_input.setSpecialValueText("미설정")
        settlement_input.setFixedWidth(170)
        try:
            settlement_input.setValue(_parse_settlement_amount(quiz_meta.get("settlement_amount")))
        except (TypeError, ValueError):
            settlement_input.setValue(0)
        mode_box = labeled_field("진행 방식", mode_combo)
        mode_box.setFixedWidth(130)
        competition_box = labeled_field("대진 방식", competition_input)
        competition_box.setFixedWidth(120)
        visibility_box = labeled_field("공개 범위", visibility_combo)
        visibility_box.setFixedWidth(180)
        question_box = labeled_field("퀴즈 문제", question_input)
        answer_box = labeled_field("정답 (정확히 일치)", answer_input)
        settlement_box = labeled_field("당첨 처리금액", settlement_input, align_left=True)
        basic_row.addWidget(mode_box)
        basic_row.addWidget(competition_box)
        basic_row.addWidget(visibility_box)
        quiz_row.addWidget(question_box, 3)
        quiz_row.addWidget(answer_box, 2)
        quiz_row.addWidget(settlement_box)
        basic_layout.addLayout(quiz_row)
        self._quiz_mode_combo = mode_combo
        self._visibility_mode_combo = visibility_combo
        self._quiz_question_input = question_input
        self._quiz_answer_input = answer_input
        self._quiz_existing_answer_digest = quiz_meta.get("answer_digest", "")
        self._quiz_settlement_input = settlement_input

        def _sync_quiz_fields():
            enabled = mode_combo.currentData() == "quiz"
            question_box.setVisible(enabled)
            answer_box.setVisible(enabled)
            settlement_box.setVisible(enabled)
            basic_card.setFixedHeight(196 if enabled else 116)

        mode_combo.currentIndexChanged.connect(lambda _index: _sync_quiz_fields())
        _sync_quiz_fields()
        panel_layout.addWidget(basic_card)

        # Deprecated fields remain alive for backward-compatible saving, but
        # are intentionally absent from every editing surface.
        self.f_start.hide()
        self.f_announce.hide()

        status_card = _core.QFrame(panel)
        status_card.setObjectName("compactStatusCard")
        status_card.setFixedHeight(500)
        status_card.setStyleSheet(
            "QFrame#compactStatusCard { background:#FFFFFF; border:1px solid #E4E7EC; "
            "border-radius:10px; }"
        )
        status_layout = _core.QVBoxLayout(status_card)
        status_layout.setContentsMargins(16, 14, 16, 16)
        status_layout.setSpacing(12)

        status_title = _core.QLabel("사진 및 상태 정보", status_card)
        status_title.setStyleSheet("font-size:14px; font-weight:900; color:#344054; background:transparent;")
        status_layout.addWidget(status_title)

        photo_section = _core.QFrame(status_card)
        photo_section.setObjectName("compactPhotoSection")
        photo_section.setFixedHeight(122)
        photo_section.setStyleSheet(
            "QFrame#compactPhotoSection { background:#F8FAFC; border:1px solid #EAECF0; "
            "border-radius:8px; }"
        )
        photo_layout = _core.QHBoxLayout(photo_section)
        photo_layout.setContentsMargins(14, 10, 14, 10)
        photo_layout.setSpacing(14)
        photo_label = _core.QLabel("사진 등록\n개체 · 형제 · 부 · 모", photo_section)
        photo_label.setFixedWidth(132)
        photo_label.setStyleSheet(
            "font-size:11px; color:#667085; font-weight:700; line-height:1.5; background:transparent;"
        )
        photo_layout.addWidget(photo_label)
        for photo_box in (self.p_item, self.p_sib, self.p_sire, self.p_dam):
            photo_box.setParent(photo_section)
            photo_box.setFixedSize(80, 98)
            photo_box.show()
            photo_layout.addWidget(photo_box, 0, _core.Qt.AlignVCenter)
        photo_layout.addStretch(1)
        status_layout.addWidget(photo_section)

        self.f_weight.setFixedSize(140, 40)
        self.f_weight.setAlignment(_core.Qt.AlignRight | _core.Qt.AlignVCenter)
        self.f_b_year.setFixedSize(92, 40)
        self.f_b_month.setFixedSize(64, 40)

        birth_widget = _core.QWidget(status_card)
        birth_layout = _core.QHBoxLayout(birth_widget)
        birth_layout.setContentsMargins(0, 0, 0, 0)
        birth_layout.setSpacing(5)
        self.f_b_year.setParent(birth_widget)
        self.f_b_month.setParent(birth_widget)
        birth_layout.addWidget(self.f_b_year)
        birth_layout.addWidget(self.f_b_month)
        birth_layout.addStretch()

        editor_grid = _core.QGridLayout()
        editor_grid.setContentsMargins(0, 0, 0, 0)
        editor_grid.setHorizontalSpacing(18)
        editor_grid.setVerticalSpacing(12)
        editor_grid.addWidget(labeled_field("성별", self.w_gender, 40, True), 0, 0)
        editor_grid.addWidget(labeled_field("무게(g)", self.f_weight, 40, True), 0, 1)
        editor_grid.addWidget(labeled_field("출생년월 (선택)", birth_widget, 40, True), 0, 2)
        editor_grid.addWidget(labeled_field("스팟", self.w_spot, 40, True), 1, 0)
        editor_grid.addWidget(labeled_field("핀", self.w_pin, 40, True), 1, 1)
        rating_fields = (
            ("size", "사이즈", 1, 2),
            ("wall", "벽높이", 2, 0),
            ("color", "색감", 2, 1),
            ("activity", "활동성", 2, 2),
            ("feed", "먹이붙임", 3, 0),
            ("structure", "체형", 3, 1),
        )
        for key, label, row, column in rating_fields:
            rating = self.stars.get(key)
            if rating is not None:
                editor_grid.addWidget(labeled_field(label, rating, 30, True), row, column)
        editor_grid.setColumnStretch(0, 1)
        editor_grid.setColumnStretch(1, 1)
        editor_grid.setColumnStretch(2, 1)
        status_layout.addLayout(editor_grid, 1)
        panel_layout.addWidget(status_card)
        panel_layout.addStretch(1)

        insert_at = scroll_index if scroll_index >= 0 else max(0, root.count() - 1)
        root.insertWidget(insert_at, panel, 1)
        self._compact_detail_panel = panel

        action_layout = root.itemAt(root.count() - 1).layout() if root.count() else None
        cancel_button = next(
            (button for button in self.findChildren(_core.QPushButton) if button.text() == "취소"),
            None,
        )
        if action_layout is not None:
            action_layout.setSpacing(10)
            action_layout.insertStretch(0, 1)
        if cancel_button is not None:
            cancel_button.setFixedSize(110, 52)
        self.btn_save.setFixedSize(180, 52)
        self.btn_save.setToolTip("변경사항 저장 (Ctrl+S)")
        self.btn_save.setShortcut("Ctrl+S")

        try:
            ItemDetailDialog.setTabOrder(self.f_company, self.f_name)
            ItemDetailDialog.setTabOrder(self.f_name, mode_combo)
            ItemDetailDialog.setTabOrder(mode_combo, visibility_combo)
            ItemDetailDialog.setTabOrder(visibility_combo, question_input)
            ItemDetailDialog.setTabOrder(question_input, answer_input)
            ItemDetailDialog.setTabOrder(answer_input, settlement_input)
            gender_buttons = list(getattr(self.w_gender, "buttons", []))
            previous = settlement_input
            for gender_button in gender_buttons:
                ItemDetailDialog.setTabOrder(previous, gender_button)
                previous = gender_button
            ItemDetailDialog.setTabOrder(previous, self.f_weight)
            ItemDetailDialog.setTabOrder(self.f_weight, self.f_b_year)
            ItemDetailDialog.setTabOrder(self.f_b_year, self.f_b_month)
            ItemDetailDialog.setTabOrder(self.f_b_month, self.f_note)
            ItemDetailDialog.setTabOrder(self.f_note, self.btn_save)
        except Exception:
            pass

        _core.QTimer.singleShot(0, lambda: (self.f_name.setFocus(), self.f_name.selectAll()))

    def _on_save(self):
        mode_combo = getattr(self, "_quiz_mode_combo", None)
        mode = str(mode_combo.currentData() or "auction") if mode_combo is not None else "auction"
        visibility_combo = getattr(self, "_visibility_mode_combo", None)
        visibility_mode = (
            str(visibility_combo.currentData() or "inherit")
            if visibility_combo is not None
            else "inherit"
        )
        is_quiz = mode == "quiz"
        question = getattr(self, "_quiz_question_input", None)
        answer = getattr(self, "_quiz_answer_input", None)
        settlement = getattr(self, "_quiz_settlement_input", None)
        question_text = question.text().strip() if question is not None else ""
        answer_text = answer.text().strip() if answer is not None else ""
        existing_answer_digest = str(getattr(self, "_quiz_existing_answer_digest", "") or "").strip()
        if is_quiz and not question_text:
            _core.QMessageBox.warning(self, "퀴즈 설정", "화면에 표시할 문제를 입력해주세요.")
            if question is not None:
                question.setFocus()
            return
        if is_quiz and not answer_text and not existing_answer_digest:
            _core.QMessageBox.warning(self, "퀴즈 설정", "정답을 입력해주세요.")
            if answer is not None:
                answer.setFocus()
            return

        settlement_amount = settlement.value() if settlement is not None else 0
        if is_quiz and settlement_amount <= 0:
            _core.QMessageBox.warning(self, "퀴즈 설정", "라벨과 정산에 사용할 당첨 처리금액을 입력해주세요.")
            if settlement is not None:
                settlement.setFocus()
            return

        original_checklist = self.item.get("checklist", "")
        original_on_save(self)
        sale_config = {
            "question": question_text,
            "answer": answer_text,
            "answer_digest": existing_answer_digest,
            "settlement_amount": _settlement_amount_text(settlement_amount) if is_quiz else "",
        }
        merged_checklist = _merge_checklist_after_edit(
            original_checklist,
            self.item.get("checklist", ""),
            mode,
            sale_config,
        )
        self.item["checklist"] = _replace_visibility_checklist(merged_checklist, visibility_mode)

    ItemDetailDialog.__init__ = __init__
    ItemDetailDialog._on_save = _on_save


def _patch_main_visual_hierarchy():
    MainWindow = _core.MainWindow
    AuctionCardWidget = _core.AuctionCardWidget
    original_main_init = MainWindow.__init__
    original_set_filter = MainWindow._set_filter
    original_card_init = AuctionCardWidget.__init__
    original_show_item_detail = AuctionCardWidget.show_item_detail
    original_set_active = AuctionCardWidget.set_active
    original_set_idle = AuctionCardWidget.set_idle

    def _apply_filter_styles(self):
        current = getattr(self, "_filter", "전체")
        for key, button in (getattr(self, "_filter_btns", {}) or {}).items():
            selected = key == current
            button.setCursor(_core.Qt.PointingHandCursor)
            button.setFixedHeight(34)
            button.setStyleSheet(
                "QPushButton {"
                + (
                    "background:#FFFFFF; color:#173E8F; border:1px solid #DCE3F0;"
                    if selected
                    else "background:transparent; color:#667085; border:1px solid transparent;"
                )
                + "border-radius:7px; padding:5px 16px; font-size:12px; font-weight:700; }"
                + "QPushButton:hover { background:#FFFFFF; color:#173E8F; }"
            )

    def _set_filter(self, value):
        result = original_set_filter(self, value)
        _apply_filter_styles(self)
        return result

    def _polish_top_bar(self):
        top_bar = self.findChild(_core.QWidget, "topBar")
        if top_bar is not None:
            top_bar.setFixedHeight(54)
            top_bar.setStyleSheet(
                "QWidget#topBar { background:#123C82; border:none; }"
                "QWidget#topBar QLabel { color:rgba(255,255,255,0.78); background:transparent; }"
            )

        for label_name in ("lbl_band", "lbl_sheet", "lbl_chat_mute", "lbl_auto_print"):
            label = getattr(self, label_name, None)
            if label is not None:
                label.setStyleSheet(
                    "color:rgba(255,255,255,0.80); font-size:11px; font-weight:700; background:transparent;"
                )

        if top_bar is not None:
            title_label = next(
                (label for label in top_bar.findChildren(_core.QLabel) if label.text() == "경매 모니터"),
                None,
            )
            if title_label is not None:
                title_label.setStyleSheet(
                    "color:#FFFFFF; font-size:16px; font-weight:900; background:transparent;"
                )

        combo = getattr(self, "cmb_tab", None)
        if combo is not None:
            # items / parents / config are internal storage tables, not an
            # operator-facing mode switch. Keep the selector available to the
            # runtime but remove it from the primary work surface.
            combo.setVisible(False)
            _core.QTimer.singleShot(1200, lambda: combo.setVisible(False))
            _core.QTimer.singleShot(5000, lambda: combo.setVisible(False))

        if top_bar is not None:
            for button in top_bar.findChildren(_core.QPushButton):
                button.setFixedHeight(36)
                button.setCursor(_core.Qt.PointingHandCursor)
                button.setStyleSheet(
                    "QPushButton { background:rgba(255,255,255,0.10); color:white; "
                    "border:1px solid rgba(255,255,255,0.18); border-radius:6px; "
                    "padding:5px 13px; font-size:12px; font-weight:700; }"
                    "QPushButton:hover { background:rgba(255,255,255,0.18); }"
                )

    def _polish_item_list(self):
        list_card = self.item_list_w.findChild(_core.QWidget, "listCard")
        if list_card is not None:
            list_card.setStyleSheet(
                "QWidget#listCard { background:#FFFFFF; border:1px solid #E4E7EC; border-radius:10px; }"
            )
            layout = list_card.layout()
            if layout is not None:
                layout.setContentsMargins(18, 16, 18, 12)
                layout.setSpacing(10)
                stats_row = layout.itemAt(0).layout() if layout.count() else None
                if stats_row is not None:
                    stats_row.setSpacing(10)

        stat_specs = (
            ("stat_total", "#1F2937"),
            ("stat_sold", "#D64B32"),
            ("stat_sales", "#173E8F"),
            ("stat_rate", "#2E7D6B"),
        )
        for attr_name, color in stat_specs:
            value_label = getattr(self, attr_name, None)
            if value_label is None:
                continue
            card = value_label.parentWidget()
            card.setFixedHeight(66)
            card.setSizePolicy(_core.QSizePolicy.Expanding, _core.QSizePolicy.Fixed)
            card.setStyleSheet(
                "QWidget#statCard { background:#F7F8FA; border:1px solid #EEF0F3; border-radius:9px; }"
            )
            if card.layout() is not None:
                card.layout().setContentsMargins(12, 8, 12, 8)
                card.layout().setSpacing(2)
            for label in card.findChildren(_core.QLabel, options=_core.Qt.FindDirectChildrenOnly):
                if label is value_label:
                    label.setStyleSheet(f"font-size:20px; font-weight:900; color:{color}; background:transparent;")
                else:
                    label.setStyleSheet(
                        "font-size:11px; font-weight:700; color:#8B95A1; background:transparent;"
                    )

        filter_bar = self.item_list_w.findChild(_core.QWidget, "filterBar")
        if filter_bar is not None:
            filter_bar.setFixedHeight(42)
            filter_bar.setStyleSheet(
                "QWidget#filterBar { background:#F7F8FA; border:1px solid #EEF0F3; border-radius:8px; }"
            )
            if filter_bar.layout() is not None:
                filter_bar.layout().setContentsMargins(4, 4, 4, 4)
                filter_bar.layout().setSpacing(2)
        _apply_filter_styles(self)

        table = getattr(self, "item_table", None)
        if table is not None:
            table.setShowGrid(False)
            table.setFrameShape(_core.QFrame.NoFrame)
            table.setSelectionBehavior(_core.QAbstractItemView.SelectRows)
            table.verticalHeader().setVisible(False)
            table.verticalHeader().setDefaultSectionSize(36)
            table.setStyleSheet(
                "QTableWidget { background:#FFFFFF; border:none; color:#344054; "
                "selection-background-color:#EEF4FF; selection-color:#173E8F; font-size:12px; }"
                "QTableWidget::item { border-bottom:1px solid #F0F1F3; padding:6px 7px; }"
                "QHeaderView::section { background:#FFFFFF; color:#8B95A1; border:none; "
                "border-bottom:1px solid #E8EBF0; padding:8px 7px; font-size:11px; font-weight:700; }"
            )

        progress = getattr(self, "progress", None)
        if progress is not None:
            progress.setFixedHeight(7)
            progress.setTextVisible(False)
            progress.setStyleSheet(
                "QProgressBar { background:#EEF1F5; border:none; border-radius:3px; }"
                "QProgressBar::chunk { background:#315CA8; border-radius:3px; }"
            )
        stats_label = getattr(self, "lbl_stats", None)
        if stats_label is not None:
            stats_label.setAlignment(_core.Qt.AlignRight | _core.Qt.AlignVCenter)
            stats_label.setStyleSheet("font-size:11px; color:#8B95A1; background:transparent;")

    def _polish_chat(self):
        chat = getattr(self, "chat_w", None)
        if chat is None:
            return
        chat_card = chat.findChild(_core.QWidget, "chatCard")
        if chat_card is not None:
            chat_card.setStyleSheet(
                "QWidget#chatCard { background:#FFFFFF; border:1px solid #E4E7EC; border-radius:10px; }"
            )
            if chat_card.layout() is not None:
                chat_card.layout().setContentsMargins(16, 14, 16, 12)
                chat_card.layout().setSpacing(8)

        title = next((label for label in chat.findChildren(_core.QLabel) if "채팅" in label.text()), None)
        if title is not None:
            title.setStyleSheet("font-size:16px; font-weight:900; color:#1F2937; background:transparent;")

        toggle = getattr(chat, "btn_bid_toggle", None)
        if toggle is not None:
            toggle.setText("입찰만")
            toggle.setToolTip("입찰 메시지만 모아보기")
            toggle.setFixedSize(72, 32)
            toggle.setStyleSheet(
                "QPushButton { background:#F7F8FA; color:#667085; border:1px solid #E5E8EB; "
                "border-radius:7px; font-size:11px; font-weight:700; }"
                "QPushButton:hover { background:#EEF4FF; color:#173E8F; }"
            )

        chat_log = getattr(chat, "chat_log", None)
        if chat_log is not None:
            chat_log.setFrameShape(_core.QFrame.NoFrame)
            chat_log.setStyleSheet(
                "QTextEdit { background:#FFFFFF; border:none; color:#344054; padding:6px 0; font-size:12px; }"
            )

        composer = getattr(chat, "input", None)
        if composer is not None:
            composer.setFixedHeight(40)
            composer.setStyleSheet(
                "QLineEdit { background:#F7F8FA; border:1px solid #E5E8EB; border-radius:7px; "
                "padding:7px 11px; font-size:12px; color:#1F2937; }"
                "QLineEdit:focus { background:#FFFFFF; border-color:#7293CF; }"
            )
        plus = getattr(chat, "btn_plus", None)
        if plus is not None:
            plus.setFixedSize(38, 40)
            plus.setStyleSheet(
                "QPushButton { background:transparent; color:#667085; border:none; border-radius:6px; font-size:18px; }"
                "QPushButton:hover { background:#F2F4F7; }"
            )
        for button in chat.findChildren(_core.QPushButton):
            if button.text() == "전송":
                button.setFixedSize(54, 40)
                button.setStyleSheet(
                    "QPushButton { background:#173E8F; color:white; border:none; border-radius:7px; "
                    "font-size:12px; font-weight:800; }"
                    "QPushButton:hover { background:#234F9C; }"
                )

    def _polish_main_window(self):
        self.setMinimumSize(1180, 720)
        screen = _core.QApplication.primaryScreen()
        if screen is not None and _core.QApplication.platformName().lower() != "offscreen":
            available = screen.availableGeometry()
            target_width = min(1600, max(1280, int(available.width() * 0.96)))
            target_height = min(940, max(780, int(available.height() * 0.96)))
            target_width = min(target_width, available.width())
            target_height = min(target_height, available.height())
            self.resize(target_width, target_height)
            self.move(
                available.left() + max(0, (available.width() - target_width) // 2),
                available.top() + max(0, (available.height() - target_height) // 2),
            )

        central = self.centralWidget()
        if central is not None:
            central.setObjectName("mainSurface")
            central.setStyleSheet("QWidget#mainSurface { background:#F2F4F7; }")

        splitter = self.auction_card.parentWidget()
        if isinstance(splitter, _core.QSplitter):
            splitter.setHandleWidth(12)
            splitter.setChildrenCollapsible(False)
            splitter.setStyleSheet("QSplitter::handle { background:#F2F4F7; }")
            self.auction_card.setMinimumWidth(320)
            self.auction_card.setMaximumWidth(380)
            self.item_list_w.setMinimumWidth(520)
            self.chat_w.setMinimumWidth(340)
            self.chat_w.setMaximumWidth(430)
            splitter.setStretchFactor(0, 0)
            splitter.setStretchFactor(1, 1)
            splitter.setStretchFactor(2, 0)

            def _apply_splitter_sizes():
                total = max(splitter.width(), 1240)
                left_width = 330
                chat_width = 370
                splitter.setSizes([left_width, max(520, total - left_width - chat_width), chat_width])

            _apply_splitter_sizes()
            _core.QTimer.singleShot(0, _apply_splitter_sizes)

        _polish_top_bar(self)
        _polish_item_list(self)
        _polish_chat(self)

    def _card_container(self):
        return self.findChild(_core.QWidget, "auctionCard")

    def _set_operational_controls(self, visible):
        container = _card_container(self)
        if container is not None and container.layout() is not None:
            layout = container.layout()
            divider = getattr(self, "_operational_divider", None)
            if divider is not None:
                divider.setVisible(visible)
            idle_spacer_index = getattr(self, "_idle_spacer_index", None)
            if idle_spacer_index is not None:
                layout.setStretch(idle_spacer_index, 0 if visible else 1)
            bid_table_index = getattr(self, "_bid_table_layout_index", None)
            if bid_table_index is not None:
                layout.setStretch(bid_table_index, 1 if visible else 0)
            layout.invalidate()
        for widget in (
            getattr(self, "bid_table", None),
            getattr(self, "btn_manual_bid_add", None),
            getattr(self, "btn_manual_bid_edit", None),
            getattr(self, "btn_manual_bid_delete", None),
            getattr(self, "btn_sold", None),
            getattr(self, "btn_countdown", None),
            getattr(self, "btn_unsold", None),
            getattr(self, "btn_cancel", None),
            getattr(self, "btn_correct", None),
        ):
            if widget is not None:
                widget.setVisible(visible)

        for widget in (
            getattr(self, "lbl_highest", None),
            getattr(self, "lbl_winner", None),
            getattr(self, "lbl_bid_count", None),
        ):
            if widget is not None:
                widget.setVisible(visible and bool(widget.text().strip()))

        for button in (
            getattr(self, "btn_manual_bid_add", None),
            getattr(self, "btn_manual_bid_edit", None),
            getattr(self, "btn_manual_bid_delete", None),
        ):
            if button is not None:
                button.setFixedHeight(40)

        for button in (
            getattr(self, "btn_sold", None),
            getattr(self, "btn_countdown", None),
            getattr(self, "btn_unsold", None),
            getattr(self, "btn_cancel", None),
            getattr(self, "btn_correct", None),
        ):
            if button is not None:
                button.setFixedHeight(52)

    def _style_card_state(self, active=False):
        self.lbl_badge.setStyleSheet(
            "background:" + ("#FFF0EC" if active else "#EEF2F6") + ";"
            "color:" + ("#C94730" if active else "#667085") + ";"
            "border:none; border-radius:10px; padding:5px 10px; font-size:11px; font-weight:800;"
        )
        self.lbl_header.setStyleSheet("font-size:22px; font-weight:900; color:#1F2937; background:transparent;")
        self.lbl_start_price.setStyleSheet(
            "font-size:12px; color:#667085; font-weight:700; background:transparent;"
        )

    def _style_start_button(self):
        button = getattr(self, "btn_panel_start", None)
        if button is None:
            return
        button.setFixedHeight(60)
        blocked = button.text().startswith("경매 진행중")
        bg = "#F2F4F7" if blocked else "#D64B32"
        fg = "#667085" if blocked else "#FFFFFF"
        hover = "#E8EBF0" if blocked else "#BE3F2A"
        button.setStyleSheet(
            f"QPushButton {{ background:{bg}; color:{fg}; border:none; border-radius:8px; "
            "font-size:16px; font-weight:900; }}"
            f"QPushButton:hover {{ background:{hover}; }}"
        )

    def _compact_card_content(self):
        self.lbl_header.setFixedHeight(38)
        self.lbl_header.setSizePolicy(_core.QSizePolicy.Preferred, _core.QSizePolicy.Fixed)
        self.lbl_start_price.setFixedHeight(24)
        self.lbl_start_price.setSizePolicy(_core.QSizePolicy.Preferred, _core.QSizePolicy.Fixed)

        quick_panel = getattr(self, "detail_grid_widget", None)
        if quick_panel is not None:
            quick_panel.setFixedHeight(174)
            quick_panel.setSizePolicy(_core.QSizePolicy.Preferred, _core.QSizePolicy.Fixed)

    def _polish_auction_card(self):
        container = _card_container(self)
        if container is None:
            return
        container.setStyleSheet(
            "QWidget#auctionCard { background:#FFFFFF; border:1px solid #E4E7EC; border-radius:10px; }"
        )
        layout = container.layout()
        if layout is not None:
            layout.setContentsMargins(20, 18, 20, 16)
            layout.setSpacing(10)
            layout.setAlignment(_core.Qt.AlignTop)
            photo_layout = layout.itemAt(3).layout() if layout.count() > 3 else None
            if photo_layout is not None:
                photo_layout.setContentsMargins(0, 5, 0, 7)
                photo_layout.setSpacing(10)

            if not hasattr(self, "_idle_spacer_index"):
                self._operational_divider = layout.itemAt(6).widget() if layout.count() > 6 else None
                self._idle_spacer_index = 6
                layout.insertStretch(self._idle_spacer_index, 1)
                self._bid_table_layout_index = next(
                    (
                        index
                        for index in range(layout.count())
                        if layout.itemAt(index).widget() is getattr(self, "bid_table", None)
                    ),
                    None,
                )

        _compact_card_content(self)

        for avatar in getattr(self, "_photo_avatars", {}).values():
            avatar.setFixedSize(44, 44)

        icon_style = (
            "QPushButton { background:transparent; color:#667085; border:none; border-radius:6px; "
            "font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F2F4F7; color:#173E8F; }"
        )
        compact_actions = (
            (getattr(self, "btn_capture", None), "캡처"),
            (getattr(self, "btn_print", None), "라벨"),
            (getattr(self, "btn_gear", None), "상세"),
        )
        for button, label in compact_actions:
            if button is not None:
                button.setText(label)
                button.setFixedSize(50, 34)
                button.setStyleSheet(icon_style)

        manual_style = (
            "QPushButton { background:#FFFFFF; color:#475467; border:1px solid #DDE1E7; "
            "border-radius:6px; padding:5px 8px; font-size:10px; font-weight:700; }"
            "QPushButton:hover { background:#F7F9FC; color:#173E8F; border-color:#B9C8E3; }"
        )
        for button in (
            getattr(self, "btn_manual_bid_add", None),
            getattr(self, "btn_manual_bid_edit", None),
            getattr(self, "btn_manual_bid_delete", None),
        ):
            if button is not None:
                button.setFixedHeight(34)
                button.setStyleSheet(manual_style)

        table = getattr(self, "bid_table", None)
        if table is not None:
            table.setShowGrid(False)
            table.setFrameShape(_core.QFrame.NoFrame)
            table.verticalHeader().setVisible(False)
            table.verticalHeader().setDefaultSectionSize(28)
            table.setStyleSheet(
                "QTableWidget { background:#FFFFFF; border:none; color:#344054; font-size:11px; "
                "selection-background-color:#EEF4FF; selection-color:#173E8F; }"
                "QTableWidget::item { border-bottom:1px solid #F0F1F3; padding:4px; }"
                "QHeaderView::section { background:#F7F8FA; color:#8B95A1; border:none; "
                "border-bottom:1px solid #E8EBF0; padding:6px; font-size:10px; font-weight:700; }"
            )

        self.btn_sold.setStyleSheet(
            "QPushButton { background:#173E8F; color:white; border:none; border-radius:7px; font-weight:900; }"
            "QPushButton:hover { background:#234F9C; }"
        )
        countdown_button = getattr(self, "btn_countdown", None)
        if countdown_button is not None:
            countdown_button.setStyleSheet(
                "QPushButton { background:#FFF9EE; color:#8A5A00; border:1px solid #E9C77C; "
                "border-radius:7px; font-size:11px; font-weight:850; padding:0 6px; }"
                "QPushButton:hover { background:#FFF0CF; border-color:#D8AA4E; }"
            )
        secondary_action_style = (
            "QPushButton { background:#FFFFFF; color:#667085; border:1px solid #DDE1E7; "
            "border-radius:7px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F7F8FA; }"
        )
        for button in (self.btn_unsold, self.btn_cancel, self.btn_correct):
            button.setStyleSheet(secondary_action_style)

        _style_card_state(self, False)
        _set_operational_controls(self, False)

    def __init__(self, *args, **kwargs):
        original_card_init(self, *args, **kwargs)
        _polish_auction_card(self)

    def show_item_detail(self, item):
        result = original_show_item_detail(self, item)
        _compact_card_content(self)
        mw = self.window()
        has_active = bool(getattr(mw, "active_item", None))
        is_active_item = str((item or {}).get("status") or "") == str(_core.S_ACTIVE)
        _style_card_state(self, is_active_item)
        _set_operational_controls(self, has_active)
        if has_active:
            self.btn_panel_start.setVisible(False)
        else:
            self.btn_panel_start.setVisible(True)
            _style_start_button(self)
        update_countdown = getattr(mw, "_update_auction_countdown_button", None)
        if callable(update_countdown):
            update_countdown()
        return result

    def set_active(self, item):
        result = original_set_active(self, item)
        _compact_card_content(self)
        _style_card_state(self, True)
        _set_operational_controls(self, True)
        self.btn_panel_start.setVisible(False)
        mw = self.window()
        update_countdown = getattr(mw, "_update_auction_countdown_button", None)
        if callable(update_countdown):
            update_countdown()
        return result

    def set_idle(self):
        result = original_set_idle(self)
        _style_card_state(self, False)
        _set_operational_controls(self, False)
        self.btn_panel_start.setVisible(False)
        return result

    def main_init(self, *args, **kwargs):
        original_main_init(self, *args, **kwargs)
        _polish_main_window(self)

    MainWindow.__init__ = main_init
    MainWindow._set_filter = _set_filter
    AuctionCardWidget.__init__ = __init__
    AuctionCardWidget.show_item_detail = show_item_detail
    AuctionCardWidget.set_active = set_active
    AuctionCardWidget.set_idle = set_idle


def _apply_runtime_patches():
    _patch_parse_bid()
    _patch_band_cdp()
    _patch_settings_dialog()
    _patch_auction_card_performance()
    _patch_auction_card_quick_edit()
    _patch_chat_shortcuts()
    _patch_main_window()
    _patch_main_visual_hierarchy()
    _patch_parent_selector()
    _patch_item_detail_popup()
    _patch_item_detail_layout()

def _create_data_manager(config):
    """Use the active CREO channel, with legacy Supabase as the CDCUP fallback."""
    if config.get("capture_service_url"):
        try:
            from platform_manager import ChannelAwareManager
            mgr = ChannelAwareManager(config)
            print(f"[DB] Using {mgr.backend_name}", flush=True)
            return mgr
        except Exception as exc:
            # A platform-aware launch must fail closed. Falling back to the
            # CDCUP Supabase table can display or mutate another auction.
            raise RuntimeError(f"CREO 채널 관리자 초기화 실패: {exc}") from exc
    if config.get("supabase_url") and config.get("supabase_key"):
        try:
            from supabase_manager import SupabaseManager
            mgr = SupabaseManager(config)
            print(f"[DB] Using Supabase ({mgr.url[:40]}...)", flush=True)
            return mgr
        except Exception as exc:
            print(f"[DB] Supabase init failed, falling back to Sheets: {exc}", flush=True)
    return _core.SheetsManager(config)


_apply_runtime_patches()

for _name, _value in _core.__dict__.items():
    if _name.startswith("__") and _name not in {"__doc__"}:
        continue
    globals()[_name] = _value


def main():
    app = _core.QApplication(sys.argv)
    app.setStyleSheet(_core.STYLE)
    win = _core.MainWindow()
    win.show()
    return app.exec_()


if __name__ == "__main__":
    sys.exit(main())
