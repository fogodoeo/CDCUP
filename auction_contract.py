"""Shared auction value contract for the desktop monitor.

Keep legacy Korean labels and the CREO platform lifecycle equivalent so channel
switches, totals, capture, and shipping all interpret the same record equally.
"""

import re


WAITING = "waiting"
LIVE = "live"
SOLD = "sold"
PASSED = "passed"
CANCELLED = "cancelled"


def normalize_status(value):
    status = str(value or "").strip().lower()
    if not status or status == "대기":
        return WAITING
    if status in {"sold", "완료"} or "낙찰" in status:
        return SOLD
    if status in {"passed", "unsold"} or "유찰" in status:
        return PASSED
    if status in {"cancelled", "canceled"} or "취소" in status:
        return CANCELLED
    if status in {"live", "active"} or "진행" in status or "경매" in status:
        return LIVE
    return WAITING


def to_monitor_status(value):
    return {
        WAITING: "대기",
        LIVE: "진행중",
        SOLD: "낙찰",
        PASSED: "유찰",
        CANCELLED: "취소",
    }[normalize_status(value)]


def is_sold_status(value):
    return normalize_status(value) == SOLD


def is_terminal_status(value):
    return normalize_status(value) in {SOLD, PASSED, CANCELLED}


def parse_amount(value):
    normalized = re.sub(r"[^0-9.\-]", "", str(value or "").replace(",", ""))
    try:
        return float(normalized) if normalized else 0.0
    except ValueError:
        return 0.0


def to_manwon(value):
    amount = parse_amount(value)
    if amount >= 10000:
        amount /= 10000
    return int(amount) if amount.is_integer() else amount


def to_won(value):
    amount = parse_amount(value)
    if 0 < amount < 10000:
        amount *= 10000
    return int(amount)


def parse_checklist(value):
    result = {}
    for part in str(value or "").split("|"):
        if ":" not in part:
            continue
        key, item_value = part.split(":", 1)
        key = key.strip()
        if key:
            result[key] = item_value.strip()
    return result


def checklist_meta(item_or_checklist):
    item = item_or_checklist if isinstance(item_or_checklist, dict) else {}
    pairs = parse_checklist(item.get("checklist", "") if item else item_or_checklist)
    slot = str(pairs.get("_slot", "")).strip().upper()
    try:
        stage = int(pairs.get("_stage", "") or 0)
    except (TypeError, ValueError):
        stage = 0
    try:
        public_number = int(pairs.get("_label", "") or item.get("num", 0) or 0)
    except (TypeError, ValueError):
        public_number = 0
    return {
        "auction_type": str(pairs.get("_auction", "")).strip().lower(),
        "visibility_mode": str(pairs.get("_visibility", "")).strip().lower(),
        "tournament_code": slot,
        "team_code": str(pairs.get("_team") or (slot[:1] if slot else "")).strip().upper(),
        "tournament_stage": stage,
        "public_number": public_number,
    }
