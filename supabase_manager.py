"""
SupabaseManager — SheetsManager 호환 인터페이스로 Supabase REST API에 접근.
requests 만 사용하여 추가 의존성 없음.
"""
import base64
import io
import json
import os
import re
import threading
import time

import requests

from auction_contract import to_monitor_status


def _normalize_phone(value):
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    return "010" + digits if len(digits) == 8 else digits


def _normalize_phone_in_text(value):
    return re.sub(r"(?<!\d)(\d{8})(?!\d)", r"010\1", str(value or ""))


class SupabaseWorksheet:
    """Emulates a gspread Worksheet object, translating Cell updates to Supabase PATCH queries."""
    def __init__(self, manager):
        self.manager = manager
        self.title = "items"

    def clean_status_value(self, val):
        # Unknown or damaged values must never become a live auction. The
        # shared lifecycle contract safely normalizes them to waiting.
        return to_monitor_status(val)

    def update_cells(self, cells, value_input_option=None):
        """Translate gspread.Cell updates into Supabase PATCH calls."""
        # drag-and-drop reordering updates 'num' column
        for cell in cells:
            row_id = cell.row  # DB record id
            col_idx = cell.col # 1-indexed column
            val = cell.value

            payload = {}
            if col_idx == 2:  # COL_NUM + 1 (1 + 1)
                try:
                    payload["num"] = int(val)
                except ValueError:
                    payload["num"] = val
            elif col_idx == 1:  # COL_COMPANY + 1
                payload["company"] = val
            elif col_idx == 3:  # COL_NAME + 1
                payload["name"] = val
            elif col_idx == 4:  # COL_PRICE + 1
                payload["start_price"] = val
            elif col_idx == 5:  # COL_NOTE + 1
                payload["note"] = val
            elif col_idx == 6:  # COL_ANNOUNCE + 1
                payload["announce"] = val
            elif col_idx == 11: # COL_STATUS + 1
                payload["status"] = self.clean_status_value(val)
            elif col_idx == 12: # COL_SOLD_PRICE + 1
                payload["sold_price"] = val
            elif col_idx == 13: # COL_WINNER + 1
                payload["winner"] = val
            elif col_idx == 14: # COL_START_TIME + 1
                payload["start_time"] = val
            elif col_idx == 15: # COL_BID_LOG + 1
                payload["bid_log"] = val

            if payload:
                try:
                    r = self.manager._rest("PATCH", f"items?id=eq.{row_id}", json=payload)
                    r.raise_for_status()
                except Exception as e:
                    print(f"[SupabaseWorksheet] update_cell failed (id={row_id}, col={col_idx}): {e}")


class SupabaseManager:
    """Drop-in replacement for SheetsManager using Supabase REST API."""

    # Column index matching SheetsManager (0-indexed)
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

    def __init__(self, config):
        self.config = config
        self.url = config.get("supabase_url", "").rstrip("/")
        self.key = config.get("supabase_key", "")
        self.write_enabled = bool(self.url and self.key)
        self.online = False
        self.last_read_error = ""
        self.last_write_error = ""
        self._lock = threading.Lock()
        # Compatibility stubs
        self.gc = None
        self.ws = SupabaseWorksheet(self)

        if self.url and self.key:
            # Quick connectivity check
            try:
                r = requests.get(
                    f"{self.url}/rest/v1/config?select=key&limit=1",
                    headers=self._headers(),
                    timeout=5,
                )
                self.online = r.status_code == 200
            except Exception:
                self.online = False

    def _headers(self, prefer=None):
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            h["Prefer"] = prefer
        return h

    def _rest(self, method, path, **kwargs):
        """Make a REST API call to Supabase."""
        url = f"{self.url}/rest/v1/{path}"
        kwargs.setdefault("headers", self._headers("return=representation"))
        kwargs.setdefault("timeout", 15)
        return requests.request(method, url, **kwargs)

    # ─── Connection / Tab management ───

    def connect_write(self):
        """Enable write mode (no-op for Supabase, always writable)."""
        self.write_enabled = bool(self.url and self.key)
        return self.write_enabled

    def get_tab_list(self):
        """Return available 'tabs' — just returns table names."""
        return ["items", "parents", "config"]

    def switch_tab(self, tab_name):
        """No-op for Supabase. Return True for compatibility."""
        return True

    # ─── Read operations ───

    def read_items(self):
        """Load all auction items from Supabase, formatted for the app."""
        try:
            r = self._rest("GET", "items?order=num.asc")
            r.raise_for_status()
            rows = r.json()
            self.online = True
            self.last_read_error = ""
        except Exception as e:
            self.last_read_error = str(e)
            self.online = False
            print(f"[Supabase] read_items failed: {e}")
            return []

        items = []
        for row in rows:
            # bid_log parsing to bids list if any
            bids = []
            bid_log_raw = row.get("bid_log", "")
            if bid_log_raw:
                try:
                    bids = json.loads(bid_log_raw) or []
                    for bid in bids:
                        if isinstance(bid, dict):
                            bid["name"] = _normalize_phone_in_text(bid.get("name", ""))
                except Exception:
                    bids = []

            item = {
                "row": row.get("id"),  # Use DB id as row reference
                "company": row.get("company", ""),
                "num": row.get("num", 0),
                "name": row.get("name", ""),
                "price": row.get("start_price", ""),
                "startPrice": row.get("start_price", ""),
                "note": row.get("note", ""),
                "announce": row.get("announce", ""),
                "photoItem": row.get("photo_item", ""),
                "photoSire": row.get("photo_sire", ""),
                "photoDam": row.get("photo_dam", ""),
                "photoSibling": row.get("photo_sibling", ""),
                "status": row.get("status", "대기"),
                "sold_price": row.get("sold_price", ""),
                "soldPrice": row.get("sold_price", ""),
                "winner": _normalize_phone_in_text(row.get("winner", "")),
                "winner_phone": _normalize_phone(row.get("winner_phone", "")),
                "start_time": row.get("start_time", ""),
                "startTime": row.get("start_time", ""),
                "bid_log": row.get("bid_log", ""),
                "bidLog": row.get("bid_log", ""),
                "checklist": row.get("checklist", ""),
                "checklist_parsed": row.get("checklist_parsed", ""),
                "sire_id": row.get("sire_id", ""),
                "sireId": row.get("sire_id", ""),
                "dam_id": row.get("dam_id", ""),
                "damId": row.get("dam_id", ""),
                "bids": bids
            }
            items.append(item)

        return items

    def read_parents(self):
        """Load all parent animals from Supabase."""
        try:
            r = self._rest("GET", "parents?order=created_at.desc")
            r.raise_for_status()
            rows = r.json()
            parents = []
            for row in rows:
                parents.append({
                    "id": row.get("id", ""),
                    "name": row.get("name", ""),
                    "morph": row.get("morph", ""),
                    "photo": row.get("photo", ""),
                    "gender": row.get("gender", ""),
                    "memo": row.get("memo", ""),
                    "company": row.get("company", "")
                })
            self.online = True
            return parents
        except Exception as e:
            print(f"[Supabase] read_parents failed: {e}")
            return []

    # ─── Write operations ───

    def set_result(self, row, data):
        """Save auction result (sold_price, winner, bid_log, etc.) for an item. Returns True on success, False on failure."""
        if not self.write_enabled:
            return False
        payload = {}
        mapping = {
            "status": "status",
            "sold_price": "sold_price",
            "winner": "winner",
            "winner_phone": "winner_phone",
            "start_time": "start_time",
            "bid_log": "bid_log",
        }
        for app_key, db_key in mapping.items():
            if app_key in data:
                value = str(data[app_key]) if data[app_key] is not None else ""
                payload[db_key] = _normalize_phone(value) if db_key == "winner_phone" else value

        if not payload:
            return True

        with self._lock:
            try:
                r = self._rest(
                    "PATCH",
                    f"items?id=eq.{row}",
                    json=payload,
                )
                r.raise_for_status()
                self.last_write_error = ""
                return True
            except Exception as e:
                self.last_write_error = str(e)
                print(f"[Supabase] set_result failed (row={row}): {e}")
                return False

    def update_item(self, data):
        """Update an item's editable fields."""
        if not self.write_enabled:
            return False
        row = data.get("row") or data.get("rowNum")
        if not row:
            return False

        payload = {}
        field_map = {
            "company": "company",
            "num": "num",
            "name": "name",
            "price": "start_price",
            "start_price": "start_price",
            "startPrice": "start_price",
            "note": "note",
            "announce": "announce",
            "photoItem": "photo_item",
            "photo_item": "photo_item",
            "photoSire": "photo_sire",
            "photo_sire": "photo_sire",
            "photoDam": "photo_dam",
            "photo_dam": "photo_dam",
            "photoSibling": "photo_sibling",
            "photo_sibling": "photo_sibling",
            "status": "status",
            "checklist": "checklist",
            "checklist_parsed": "checklist_parsed",
            "sire_id": "sire_id",
            "dam_id": "dam_id"
        }

        # Parse checklist if updated
        if "checklist" in data:
            def format_checklist(raw):
                if not raw:
                    return ""
                labels = {
                    "gender": "성별", "weight": "무게", "birth": "출생", "spot": "점", "pin": "풀핀",
                    "size": "도살", "wall": "월높이", "color": "색감", "activity": "활동성", "feed": "먹이붙임", "structure": "체형", "memo": "비고"
                }
                gender_map = {"M": "수컷", "F": "암컷", "U": "미구분"}
                yes_no = {"O": "있음", "X": "없음"}
                parts = raw.split("|")
                result = []
                for part in parts:
                    if ":" not in part:
                        continue
                    k, v = part.split(":", 1)
                    # Internal routing and sale-mode settings must never leak
                    # into the human-readable checklist (quiz answers included).
                    if k.startswith("_") or k in {
                        "sale_mode", "sale_config_b64", "quiz_question_b64",
                        "quiz_answer_b64", "quiz_price",
                    }:
                        continue
                    label = labels.get(k, k)
                    if k == "gender":
                        v = gender_map.get(v, v)
                    elif k in ("spot", "pin"):
                        v = yes_no.get(v, v)
                    elif k in ("size", "wall", "color", "activity", "feed", "structure"):
                        try:
                            n = int(v)
                            v = "★" * n + "☆" * (5 - n)
                        except ValueError:
                            pass
                    elif k == "weight":
                        v = v + "g"
                    result.append(f"{label}: {v}")
                return " / ".join(result)
            payload["checklist_parsed"] = format_checklist(data["checklist"])

        for app_key, db_key in field_map.items():
            if app_key in data and app_key not in ("row", "rowNum"):
                val = data[app_key]
                payload[db_key] = val if val is not None else ""

        if not payload:
            return True

        with self._lock:
            try:
                r = self._rest("PATCH", f"items?id=eq.{row}", json=payload)
                r.raise_for_status()
                return True
            except Exception as e:
                self.last_write_error = str(e)
                print(f"[Supabase] update_item failed (row={row}): {e}")
                return False

    def write_parent_ids(self, row, sire_id, dam_id):
        """Update parent IDs for an item. Returns True on success, False on failure."""
        if not self.write_enabled:
            return False
        with self._lock:
            try:
                r = self._rest(
                    "PATCH",
                    f"items?id=eq.{row}",
                    json={"sire_id": sire_id or "", "dam_id": dam_id or ""},
                )
                r.raise_for_status()
                return True
            except Exception as e:
                self.last_write_error = str(e)
                print(f"[Supabase] write_parent_ids failed: {e}")
                return False

    def update_parent_ids(self, row, sire_id, dam_id):
        """Alias for write_parent_ids."""
        return self.write_parent_ids(row, sire_id, dam_id)

    def push_all(self, items):
        """Bulk upsert all items (used for initial registration/sync). Returns True on success, False on failure."""
        if not self.write_enabled:
            return False

        rows = []
        for item in items:
            rows.append({
                "company": item.get("company", ""),
                "num": item.get("num", 0),
                "name": item.get("name", ""),
                "start_price": item.get("price", "") or item.get("start_price", ""),
                "note": item.get("note", ""),
                "announce": item.get("announce", ""),
                "photo_item": item.get("photoItem", "") or item.get("photo_item", ""),
                "photo_sire": item.get("photoSire", "") or item.get("photo_sire", ""),
                "photo_dam": item.get("photoDam", "") or item.get("photo_dam", ""),
                "photo_sibling": item.get("photoSibling", "") or item.get("photo_sibling", ""),
                "status": item.get("status", "대기"),
                "checklist": item.get("checklist", ""),
                "checklist_parsed": item.get("checklist_parsed", ""),
            })

        if not rows:
            return True

        with self._lock:
            try:
                r = self._rest(
                    "POST",
                    "items",
                    json=rows,
                    headers=self._headers("return=representation,resolution=merge-duplicates"),
                )
                r.raise_for_status()
                print(f"[Supabase] push_all: {len(rows)} items saved")
                return True
            except Exception as e:
                self.last_write_error = str(e)
                print(f"[Supabase] push_all failed: {e}")
                return False

    def upload_photo_to_drive(self, file_path):
        """Upload a photo to Supabase Storage."""
        if not self.write_enabled or not os.path.exists(file_path):
            return ""

        filename = f"{int(time.time())}_{os.path.basename(file_path)}"
        storage_url = f"{self.url}/storage/v1/object/auction-photos/{filename}"

        try:
            with open(file_path, "rb") as f:
                file_data = f.read()

            mime = "image/jpeg"
            if file_path.lower().endswith(".png"):
                mime = "image/png"

            r = requests.post(
                storage_url,
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": mime,
                },
                data=file_data,
                timeout=30,
            )
            r.raise_for_status()

            public_url = f"{self.url}/storage/v1/object/public/auction-photos/{filename}"
            return public_url
        except Exception as e:
            print(f"[Supabase] upload_photo failed: {e}")
            # Some deployments use the database without a Storage bucket.
            # Keep photo registration usable by storing a compact WebP data URL.
            try:
                from PIL import Image

                with Image.open(file_path) as image:
                    image = image.convert("RGB")
                    output = io.BytesIO()
                    image.save(output, format="WEBP", quality=75, method=6)
                encoded = base64.b64encode(output.getvalue()).decode("ascii")
                return f"data:image/webp;base64,{encoded}"
            except Exception as fallback_error:
                print(f"[Supabase] inline photo fallback failed: {fallback_error}")
                return ""

    # ─── Config operations ───

    def _get_or_create_config_sheet(self):
        """No-op compatibility stub."""
        return None

    def _find_config_row(self, cfg_ws, key):
        """No-op compatibility stub."""
        return None

    def get_hidden_photos(self):
        """Read hidden photos setting from config table as list."""
        try:
            r = self._rest("GET", "config?key=eq.hiddenPhotos&select=value")
            r.raise_for_status()
            rows = r.json()
            value = rows[0]["value"] if rows else ""
            return [part.strip() for part in value.split(",") if part.strip()]
        except Exception:
            return []

    def set_hidden_photos(self, hidden_keys):
        """Save hidden photos setting to config table."""
        try:
            allowed = ("item", "sire", "dam", "sibling")
            hidden_set = set(hidden_keys or [])
            value = ",".join([key for key in allowed if key in hidden_set])
            r = self._rest(
                "POST",
                "config",
                json={"key": "hiddenPhotos", "value": value},
                headers=self._headers("return=minimal,resolution=merge-duplicates"),
            )
            r.raise_for_status()
            return True
        except Exception as e:
            print(f"[Supabase] set_hidden_photos failed: {e}")
            return False

    def get_banner_hidden(self):
        """Read banner hidden setting as bool."""
        try:
            r = self._rest("GET", "config?key=eq.banner_hidden&select=value")
            r.raise_for_status()
            rows = r.json()
            value = str(rows[0]["value"]).strip().lower() if rows else "0"
            return value in {"1", "true", "y", "yes", "on"}
        except Exception:
            return False

    def set_banner_hidden(self, hidden):
        """Save banner hidden setting."""
        try:
            value = "1" if hidden else "0"
            r = self._rest(
                "POST",
                "config",
                json={"key": "banner_hidden", "value": value},
                headers=self._headers("return=minimal,resolution=merge-duplicates"),
            )
            r.raise_for_status()
            return True
        except Exception as e:
            print(f"[Supabase] set_banner_hidden failed: {e}")
            return False
