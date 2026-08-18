"""Small, UI-independent client for CREO capture jobs.

The Band monitor and its settings dialog share this module so capture payload,
authentication, retry and error handling cannot drift between two code paths.
"""

from __future__ import annotations

import time

import requests


class CaptureConfigurationError(ValueError):
    """Raised before a network call when capture settings are incomplete."""


def _text(value):
    return str(value or "").strip()


def build_capture_payload(item, *, sold_price="", winner="", manual=False,
                          start_marker="", event_nonce=None, channel_id="auto"):
    item = item or {}
    item_id = _text(item.get("row") or item.get("id"))
    if not item_id:
        raise CaptureConfigurationError("캡처할 개체 ID가 없습니다.")
    resolved_channel = _text(channel_id) or "auto"
    marker = _text(start_marker or item.get("start_time")) or "auction"
    if manual:
        nonce = event_nonce if event_nonce is not None else time.time_ns()
        event_marker = f"manual:{nonce}"
    else:
        event_marker = f"sold:{marker}:{_text(sold_price)}:{_text(winner)}"
    return {
        "channelId": resolved_channel,
        "itemId": item_id,
        "itemNumber": item.get("num") or item.get("publicNumber") or 0,
        "itemName": item.get("name") or "개체",
        "vendorName": item.get("company") or "",
        "eventKey": f"{item_id}:{event_marker}",
        # A manual shot should replace the specimen's current image. A closing
        # shot keeps any successful manual capture made during the auction.
        "skipIfCaptured": not manual,
    }


class CaptureClient:
    def __init__(self, service_url, token, channel_id="auto", *, request_func=None, sleep_func=None):
        self.service_url = _text(service_url).rstrip("/")
        self.token = _text(token)
        self.channel_id = _text(channel_id) or "auto"
        self._request = request_func or requests.request
        self._sleep = sleep_func or time.sleep

    def validate(self):
        if not self.service_url:
            raise CaptureConfigurationError("CREO 캡처 서버 주소가 없습니다.")
        if not self.token:
            raise CaptureConfigurationError("캡처 토큰 또는 관리자 비밀번호가 없습니다.")
        return self

    @property
    def headers(self):
        self.validate()
        return {
            "Content-Type": "application/json",
            "X-Creo-Capture-Token": self.token,
            # The server accepts a dedicated capture token first and the admin
            # secret as a backwards-compatible fallback.
            "X-Creo-Admin": self.token,
        }

    @staticmethod
    def _body(response):
        try:
            return response.json()
        except Exception:
            return {}

    def check(self, timeout=8):
        response = self._request(
            "GET",
            f"{self.service_url}/api/capture/agent-check",
            headers=self.headers,
            timeout=timeout,
        )
        response.raise_for_status()
        return self._body(response)

    def queue(self, payload, *, attempts=3, timeout=8):
        self.validate()
        if not _text((payload or {}).get("itemId")):
            raise CaptureConfigurationError("캡처할 개체 ID가 없습니다.")
        last_error = None
        for attempt in range(max(1, int(attempts))):
            try:
                response = self._request(
                    "POST",
                    f"{self.service_url}/api/capture/jobs",
                    headers=self.headers,
                    json=payload,
                    timeout=timeout,
                )
                response.raise_for_status()
                return self._body(response)
            except Exception as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    self._sleep(1.0 + attempt)
        raise RuntimeError(f"캡처 요청 실패: {last_error}") from last_error
