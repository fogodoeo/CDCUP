"""Channel-aware auction data manager for the Band monitor.

Legacy CDCUP auctions continue to use Supabase directly. Platform channels use
the active CREO channel workspace so one monitor can operate either system.
"""

import json
import os
import threading
import time

import requests

from auction_contract import normalize_status as _status_to_platform
from auction_contract import to_manwon as _to_manwon
from auction_contract import to_monitor_status as _status_to_monitor
from auction_contract import to_won as _to_won
from supabase_manager import SupabaseManager


class ChannelAwareWorksheet:
    def __init__(self, manager):
        self.manager = manager
        self.title = "items"

    def clean_status_value(self, value):
        return _status_to_monitor(_status_to_platform(value))

    def update_cells(self, cells, value_input_option=None):
        if not self.manager.using_platform:
            return self.manager.legacy.ws.update_cells(cells, value_input_option=value_input_option)
        fields = {
            1: "company",
            2: "num",
            3: "name",
            4: "startPrice",
            5: "note",
            6: "announce",
            11: "status",
            12: "sold_price",
            13: "winner",
            14: "start_time",
            15: "bid_log",
        }
        grouped = {}
        for cell in cells:
            key = fields.get(int(cell.col))
            if key:
                grouped.setdefault(str(cell.row), {"row": cell.row})[key] = cell.value
        for payload in grouped.values():
            if not self.manager.update_item(payload):
                raise RuntimeError(self.manager.last_write_error or "채널 개체를 갱신하지 못했습니다.")


class ChannelAwareManager:
    channel_aware = True

    COL_COMPANY = 0
    COL_NUM = 1
    COL_NAME = 2
    COL_PRICE = 3
    COL_NOTE = 4
    COL_ANNOUNCE = 5
    COL_STATUS = 10
    COL_SOLD_PRICE = 11
    COL_WINNER = 12
    COL_START_TIME = 13
    COL_BID_LOG = 14

    def __init__(self, config, legacy=None, request_func=None):
        self.config = config
        self.legacy = legacy or SupabaseManager(config)
        self._http_session = None if request_func else requests.Session()
        self._request_func = request_func or self._http_session.request
        self.base_url = str(config.get("capture_service_url") or "https://creok.onrender.com").rstrip("/")
        self.admin_password = str(
            config.get("platform_admin_password")
            or os.getenv("CREO_PLATFORM_ADMIN_PASSWORD")
            or ""
        ).strip()
        self.write_enabled = bool(self.base_url and self.admin_password)
        self.online = False
        self.last_read_error = ""
        self.last_write_error = ""
        self.channel_id = ""
        self.channel = {}
        self.using_platform = False
        self._context_verified = False
        self._context_at = 0.0
        self._context_workspace = None
        self._items = {}
        self._items_channel_id = ""
        self._lock = threading.RLock()
        self._write_lock = threading.RLock()
        self._write_generation = 0
        self._stage_sequence = 0
        self._staged_item_updates = {}
        self.ws = ChannelAwareWorksheet(self)
        self.refresh_context(force=True)

    def _request(self, path, method="GET", payload=None, admin=False, timeout=12):
        if admin and not self.admin_password:
            raise RuntimeError("채널 운영 관리자 비밀번호가 설정되지 않았습니다.")
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if admin:
            headers["X-Creo-Admin"] = self.admin_password
        response = self._request_func(
            method,
            f"{self.base_url}/api/platform/{str(path).lstrip('/')}",
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        try:
            body = response.json()
        except Exception:
            body = {}
        if not response.ok:
            raise RuntimeError(body.get("error") or f"채널 API 오류 {response.status_code}")
        return body

    def refresh_context(self, force=False):
        if not force and time.monotonic() - self._context_at < 1.0:
            return self.using_platform
        self._context_at = time.monotonic()
        try:
            previous_channel_id = self.channel_id
            try:
                context = self._request("operator-context", admin=True)
                channel_id = str(context.get("activeChannelId") or "")
                channel = context.get("channel") or {}
                context_workspace = context.get("workspace")
            except Exception:
                active = self._request("active-channel")
                channel_id = str(active.get("channelId") or "")
                channel = self._request(f"channels/{channel_id}").get("channel", {}) if channel_id else {}
                context_workspace = None
            self.channel_id = channel_id
            self.channel = channel
            self._context_workspace = context_workspace
            self.using_platform = bool(channel_id and channel.get("dataAdapter") != "legacy-cdcup")
            self._context_verified = bool(channel_id and channel)
            if previous_channel_id and channel_id != previous_channel_id:
                # Rows displayed by the monitor belong to the channel that was
                # active when they were loaded. Never reuse those cached IDs
                # after an external channel switch; different channels may use
                # the same item ID.
                self._items = {}
                self._items_channel_id = ""
                self._staged_item_updates = {}
            self.online = True
            self.last_read_error = ""
        except Exception as exc:
            self._context_workspace = None
            # Fail closed. A temporary channel API outage must not silently
            # switch a CREYON/CREWARTS operation to the legacy CDCUP rows.
            # Keep the last verified adapter; without one, expose no items.
            self.online = False
            self.last_read_error = str(exc)
        return self.using_platform

    def _context_ready(self, force=False):
        self.refresh_context(force=force)
        return self._context_verified

    @property
    def backend_name(self):
        if not self._context_verified:
            return "CREO 채널 · 연결 확인 필요"
        if self.using_platform and not self.admin_password:
            return f"CREO 채널 · {self.channel.get('name', self.channel_id)} · 관리자 인증 필요"
        return f"CREO 채널 · {self.channel.get('name', self.channel_id)}" if self.using_platform else "Supabase · CDCUP"

    def connect_write(self):
        if not self._context_ready(force=True):
            return False
        return self.write_enabled if self.using_platform else self.legacy.connect_write()

    def update_broadcast_config(self, patch):
        """Update only the currently verified platform channel's overlay config."""
        if not self._context_ready(force=True):
            raise RuntimeError(self.last_read_error or "현재 운영 채널을 확인하지 못했습니다.")
        if not self.using_platform:
            return False
        result = self._request(
            f"channels/{self.channel_id}/broadcast-config",
            method="PUT",
            payload={"patch": dict(patch or {})},
            admin=True,
        )
        return bool(result.get("config") is not None)

    def resolve_audience_assignment(
        self,
        item_id,
        bidder_key,
        name,
        amount,
        message_key="",
        bid_sequence=0,
        region="",
    ):
        """Resolve one accepted live bidder without blocking the auction state.

        The server owns the session cutoff and the stable house assignment.  A
        retry is safe because the member/session pair is idempotent.
        """
        # The assignment endpoint independently verifies the active channel and
        # live item. Re-fetching operator-context before every bid added another
        # network round trip without weakening that server-side guard.
        if not self._context_verified and not self._context_ready(force=True):
            raise RuntimeError(self.last_read_error or "현재 운영 채널을 확인하지 못했습니다.")
        if not self.using_platform:
            return {}
        competition = self.channel.get("audienceCompetition") or {}
        if not (
            competition.get("enabled") is True
            and competition.get("assignment") == "survey-random"
        ):
            return {}
        return self._request(
            f"channels/{self.channel_id}/audience-assignment",
            method="POST",
            payload={
                "itemId": str(item_id or ""),
                "bidder_key": str(bidder_key or ""),
                "name": str(name or ""),
                "region": str(region or ""),
                "amount": float(amount or 0),
                "message_key": str(message_key or ""),
                "bid_sequence": max(0, int(bid_sequence or 0)),
            },
            admin=True,
            timeout=3,
        )

    def get_tab_list(self):
        if not self._context_ready():
            return ["items"]
        return ["items"] if self.using_platform else self.legacy.get_tab_list()

    def switch_tab(self, tab_name):
        if not self._context_ready():
            return False
        return True if self.using_platform else self.legacy.switch_tab(tab_name)

    def _legacy_item(self, item):
        attrs = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
        bid_log = attrs.get("bid_log") or "[]"
        try:
            bids = json.loads(bid_log) if isinstance(bid_log, str) else (bid_log or [])
        except Exception:
            bids = []
        price = _to_manwon(item.get("startPrice"))
        sold = _to_manwon(item.get("soldPrice"))
        return {
            "row": item.get("id"),
            "id": item.get("id"),
            "company": item.get("vendorName", ""),
            "num": item.get("lotNumber", 0),
            "name": item.get("name", ""),
            "price": price,
            "startPrice": price,
            "note": item.get("note", ""),
            "announce": attrs.get("announce", item.get("note", "")),
            "photoItem": item.get("photoUrl", ""),
            "photoSire": attrs.get("photo_sire", ""),
            "photoDam": attrs.get("photo_dam", ""),
            "photoSibling": attrs.get("photo_sibling", ""),
            "status": _status_to_monitor(item.get("status")),
            "sold_price": sold,
            "soldPrice": sold,
            "winner": item.get("winnerAlias") or item.get("winnerName", ""),
            "winner_phone": item.get("winnerPhone", ""),
            "start_time": attrs.get("start_time", ""),
            "startTime": attrs.get("start_time", ""),
            "bid_log": bid_log,
            "bidLog": bid_log,
            "checklist": attrs.get("checklist", ""),
            "checklist_parsed": attrs.get("checklist_parsed", ""),
            "sire_id": attrs.get("sire_id", ""),
            "sireId": attrs.get("sire_id", ""),
            "dam_id": attrs.get("dam_id", ""),
            "damId": attrs.get("dam_id", ""),
            "bids": bids,
        }

    def read_items(self):
        with self._lock:
            read_generation = self._write_generation
        if not self._context_ready(force=True):
            return []
        if not self.using_platform:
            self._items = {}
            self._items_channel_id = ""
            return self.legacy.read_items()
        try:
            workspace = self._context_workspace or self._request(f"channels/{self.channel_id}/workspace", admin=True)
            self._context_workspace = None
            rows = workspace.get("items") or []
            with self._lock:
                if self._write_generation != read_generation and self._items_channel_id == self.channel_id:
                    rows = list(self._items.values())
                else:
                    merged_rows = []
                    for source in rows:
                        item = dict(source)
                        staged = self._staged_item_updates.get(str(item.get("id")))
                        if staged:
                            item = self._merge_platform_item_record(item, staged.get("data") or {})
                        merged_rows.append(item)
                    rows = merged_rows
                    self._items = {str(item.get("id")): item for item in rows}
                    self._items_channel_id = self.channel_id
            self.online = True
            self.last_read_error = ""
            return [self._legacy_item(item) for item in sorted(rows, key=lambda row: int(row.get("lotNumber") or 0))]
        except Exception as exc:
            self.online = False
            self.last_read_error = str(exc)
            print(f"[Platform] read_items failed: {exc}", flush=True)
            return []

    def read_parents(self):
        if not self._context_ready():
            return []
        return [] if self.using_platform else self.legacy.read_parents()

    def _current_record(self, row):
        if self._items_channel_id != self.channel_id:
            raise RuntimeError("운영 채널이 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.")
        key = str(row or "")
        record = self._items.get(key)
        if record:
            return record
        raise RuntimeError("현재 화면에 불러온 채널 목록에서 개체를 찾을 수 없습니다. 목록을 새로고침해주세요.")

    def _merge_platform_item_record(self, current, data):
        attrs = dict(current.get("attributes") or {})
        attr_fields = {
            "announce": "announce",
            "photoSire": "photo_sire",
            "photoDam": "photo_dam",
            "photoSibling": "photo_sibling",
            "checklist": "checklist",
            "checklist_parsed": "checklist_parsed",
            "sire_id": "sire_id",
            "dam_id": "dam_id",
            "start_time": "start_time",
            "bid_log": "bid_log",
        }
        for source, target in attr_fields.items():
            if source in data:
                attrs[target] = data[source] if data[source] is not None else ""
        record = {**current, "attributes": attrs}
        mapping = {
            "company": "vendorName",
            "num": "lotNumber",
            "name": "name",
            "note": "note",
            "photoItem": "photoUrl",
            "winner_phone": "winnerPhone",
        }
        for source, target in mapping.items():
            if source in data:
                record[target] = data[source] if data[source] is not None else ""
        for source in ("price", "start_price", "startPrice"):
            if source in data:
                record["startPrice"] = _to_won(data[source])
                break
        if "sold_price" in data:
            record["soldPrice"] = _to_won(data["sold_price"])
        if "status" in data:
            record["status"] = _status_to_platform(data["status"])
        if "winner" in data:
            record["winnerAlias"] = str(data["winner"] or "")
            record["winnerName"] = str(data["winner"] or "")
        for key in ("createdAt", "updatedAt", "channelId"):
            record.pop(key, None)
        return record

    def stage_item_update(self, data):
        """Keep an unsaved editor draft authoritative during refresh/start races."""
        if not self._context_verified or not self.using_platform:
            return False
        row = str(data.get("row") or data.get("rowNum") or "")
        if not row:
            return False
        editable = {
            key: value for key, value in dict(data or {}).items()
            if key in {
                "company", "num", "name", "price", "start_price", "startPrice",
                "note", "announce", "photoItem", "photoSire", "photoDam",
                "photoSibling", "checklist", "checklist_parsed", "sire_id", "dam_id",
            }
        }
        if not editable:
            return False
        with self._lock:
            if self._items_channel_id != self.channel_id or row not in self._items:
                return False
            self._stage_sequence += 1
            self._staged_item_updates[row] = {
                "revision": self._stage_sequence,
                "data": editable,
            }
            self._items[row] = self._merge_platform_item_record(self._items[row], editable)
        return True

    def _save_platform_item(self, row, data, transition=False):
        row_key = str(row)
        with self._write_lock:
            with self._lock:
                current = self._current_record(row)
                if not current:
                    raise RuntimeError("현재 채널에서 개체를 찾을 수 없습니다.")
                record = self._merge_platform_item_record(current, data)
                staged = self._staged_item_updates.get(row_key)
                staged_revision = int((staged or {}).get("revision") or 0)
                if staged:
                    record = self._merge_platform_item_record(record, staged.get("data") or {})
            if transition:
                status = _status_to_platform(data.get("status"))
                mode = "live" if status == "live" else ("sold" if status == "sold" else "standby")
                result = self._request(
                    f"channels/{self.channel_id}/auction-transition",
                    method="PUT",
                    payload={"itemId": row_key, "status": status, "mode": mode, "item": record, "state": {"page": 2}},
                    admin=True,
                )
            else:
                result = self._request(
                    f"channels/{self.channel_id}/items/{row_key}",
                    method="PUT",
                    payload={"record": record},
                    admin=True,
                )
            saved = result.get("record") or result.get("item") or record
            with self._lock:
                latest_stage = self._staged_item_updates.get(row_key)
                if latest_stage and int(latest_stage.get("revision") or 0) == staged_revision:
                    self._staged_item_updates.pop(row_key, None)
                elif latest_stage:
                    saved = self._merge_platform_item_record(saved, latest_stage.get("data") or {})
                self._items[row_key] = saved
                self._write_generation += 1
                self._context_workspace = None
            return saved

    def update_item(self, data):
        # A write must always revalidate the active channel. The UI may still
        # display rows from the previous channel when an operator switches it
        # from another computer.
        if not self._context_ready(force=True):
            self.last_write_error = self.last_read_error or "현재 운영 채널을 확인하지 못했습니다."
            return False
        if not self.using_platform:
            return self.legacy.update_item(data)
        row = data.get("row") or data.get("rowNum")
        if not row:
            return False
        try:
            saved = self._save_platform_item(row, data, transition="status" in data)
            self.last_write_error = ""
            return bool(saved)
        except Exception as exc:
            self.last_write_error = str(exc)
            print(f"[Platform] update_item failed: {exc}", flush=True)
            return False

    def set_result(self, row, data):
        if not self._context_ready(force=True):
            self.last_write_error = self.last_read_error or "현재 운영 채널을 확인하지 못했습니다."
            return False
        if not self.using_platform:
            return self.legacy.set_result(row, data)
        return self.update_item({"row": row, **dict(data or {})})

    def write_parent_ids(self, row, sire_id, dam_id):
        if not self._context_ready(force=True):
            self.last_write_error = self.last_read_error or "현재 운영 채널을 확인하지 못했습니다."
            return False
        if not self.using_platform:
            return self.legacy.write_parent_ids(row, sire_id, dam_id)
        return self.update_item({"row": row, "sire_id": sire_id or "", "dam_id": dam_id or ""})

    def update_parent_ids(self, row, sire_id, dam_id):
        return self.write_parent_ids(row, sire_id, dam_id)

    def push_all(self, items):
        if not self._context_ready(force=True):
            self.last_write_error = self.last_read_error or "현재 운영 채널을 확인하지 못했습니다."
            return False
        if not self.using_platform:
            return self.legacy.push_all(items)
        try:
            existing = {str(item.get("id")): item for item in self._items.values()}
            for source in items or []:
                row = str(source.get("row") or source.get("id") or "")
                if row and row in existing:
                    if not self.update_item({"row": row, **source}):
                        return False
                    continue
                record = {
                    "lotNumber": int(source.get("num") or 0),
                    "name": source.get("name") or "",
                    "vendorName": source.get("company") or "",
                    "startPrice": _to_won(source.get("price") or source.get("startPrice")),
                    "status": _status_to_platform(source.get("status")),
                    "note": source.get("note") or "",
                    "photoUrl": source.get("photoItem") or "",
                }
                self._request(f"channels/{self.channel_id}/items", method="POST", payload={"record": record}, admin=True)
            self.read_items()
            return True
        except Exception as exc:
            self.last_write_error = str(exc)
            return False

    def upload_photo_to_drive(self, file_path):
        return self.legacy.upload_photo_to_drive(file_path)

    def get_hidden_photos(self):
        if not self._context_ready():
            return []
        return [] if self.using_platform else self.legacy.get_hidden_photos()

    def set_hidden_photos(self, hidden_keys):
        if not self._context_ready():
            return False
        return True if self.using_platform else self.legacy.set_hidden_photos(hidden_keys)

    def get_banner_hidden(self):
        if not self._context_ready():
            return False
        return False if self.using_platform else self.legacy.get_banner_hidden()

    def set_banner_hidden(self, hidden):
        if not self._context_ready():
            return False
        return True if self.using_platform else self.legacy.set_banner_hidden(hidden)
