"""Crash-safe label print history shared by the Band monitor UI."""

from __future__ import annotations

import json
import os
import threading
import time
import uuid


def label_display_text(job):
    payload = (job or {}).get("payload", {})
    status = {
        "queued": "대기",
        "printing": "출력중",
        "done": "완료",
        "failed": "실패",
    }.get((job or {}).get("status"), (job or {}).get("status", ""))
    return "[{status}] #{num} {name} / {winner} / {price} / {created}".format(
        status=status,
        num=payload.get("num", ""),
        name=payload.get("item_name", ""),
        winner=payload.get("winner_name", ""),
        price=payload.get("sold_price", ""),
        created=(job or {}).get("created_at", ""),
    )


class LabelSpool:
    def __init__(self, path, *, sleep_func=None):
        self.path = os.path.abspath(path)
        self._sleep = sleep_func or time.sleep
        self._lock = threading.RLock()

    @staticmethod
    def _empty():
        return {"version": 1, "jobs": []}

    def _load_unlocked(self):
        for attempt in range(3):
            try:
                with open(self.path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                if isinstance(data, dict) and isinstance(data.get("jobs"), list):
                    return data
                return self._empty()
            except FileNotFoundError:
                return self._empty()
            except (OSError, json.JSONDecodeError):
                if attempt < 2:
                    self._sleep(0.05)
        return self._empty()

    def load(self):
        with self._lock:
            return self._load_unlocked()

    def _save_unlocked(self, spool):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        temp_path = f"{self.path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump(spool, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    def append(self, job, *, max_jobs=300):
        with self._lock:
            spool = self._load_unlocked()
            jobs = spool.setdefault("jobs", [])
            jobs.append(dict(job or {}))
            if len(jobs) > max_jobs:
                del jobs[:len(jobs) - max_jobs]
            self._save_unlocked(spool)
            return jobs[-1]

    def find(self, job_id):
        with self._lock:
            for job in self._load_unlocked().get("jobs", []):
                if job.get("id") == job_id:
                    return job
        return None

    def update(self, job_id, **updates):
        with self._lock:
            spool = self._load_unlocked()
            for job in spool.get("jobs", []):
                if job.get("id") != job_id:
                    continue
                job.update(updates)
                job["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
                self._save_unlocked(spool)
                return job
        return None
