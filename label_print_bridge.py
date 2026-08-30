"""Loopback-only bridge from the CREO print page to the desktop D10 queue."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from urllib.parse import urlsplit


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 17876
MAX_REQUEST_BYTES = 256 * 1024
MAX_LABELS_PER_REQUEST = 120
PRODUCTION_ORIGINS = frozenset({"https://creok.onrender.com"})


class LabelBridgeRequestError(ValueError):
    """A client request cannot be converted into safe D10 label jobs."""


def is_allowed_origin(origin: str | None) -> bool:
    value = str(origin or "").strip()
    if value in PRODUCTION_ORIGINS:
        return True
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost", "[::1]", "::1"}
    )


def _clean_text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def normalize_shipping_label(label: dict) -> dict:
    if not isinstance(label, dict):
        raise LabelBridgeRequestError("라벨 형식이 올바르지 않습니다.")

    winner_name = _clean_text(label.get("winner_name"), 40)
    winner_phone = "".join(ch for ch in str(label.get("winner_phone") or "") if ch.isdigit())[:20]
    destination = _clean_text(label.get("destination"), 80)
    if not winner_name:
        raise LabelBridgeRequestError("낙찰자명이 없는 라벨이 있습니다.")
    if not winner_phone:
        raise LabelBridgeRequestError("연락처가 없는 라벨이 있습니다.")
    if not destination:
        raise LabelBridgeRequestError("수령지가 없는 라벨이 있습니다.")

    return {
        "num": _clean_text(label.get("lot_number"), 20),
        # The desktop contact layout prints this as its large first line.
        "item_name": destination,
        "winner_name": winner_name,
        "winner_phone": winner_phone,
        "sold_price": "",
        "company": "",
        "label_layout": "contact",
    }


def normalize_label_request(payload: dict) -> list[dict]:
    if not isinstance(payload, dict):
        raise LabelBridgeRequestError("요청 형식이 올바르지 않습니다.")
    labels = payload.get("labels")
    if not isinstance(labels, list) or not labels:
        raise LabelBridgeRequestError("출력할 배송 라벨이 없습니다.")
    if len(labels) > MAX_LABELS_PER_REQUEST:
        raise LabelBridgeRequestError(f"한 번에 {MAX_LABELS_PER_REQUEST}장까지만 출력할 수 있습니다.")
    return [normalize_shipping_label(label) for label in labels]


class LabelPrintBridge:
    def __init__(self, server: ThreadingHTTPServer, thread: threading.Thread):
        self.server = server
        self.thread = thread

    @property
    def port(self) -> int:
        return int(self.server.server_port)

    def shutdown(self):
        self.server.shutdown()
        self.server.server_close()


def start_label_print_bridge(
    enqueue_labels,
    status_provider=None,
    *,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
) -> LabelPrintBridge:
    """Start a daemon HTTP bridge bound only to the loopback interface."""

    provider = status_provider or (lambda: {"ready": True})

    class Handler(BaseHTTPRequestHandler):
        server_version = "CREO-D10-Bridge/1.0"

        def log_message(self, _format, *_args):
            return

        def _origin(self):
            return self.headers.get("Origin", "")

        def _send_cors_headers(self):
            origin = self._origin()
            if is_allowed_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _json(self, status: int, payload: dict):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _authorize(self) -> bool:
            if self.client_address[0] not in {"127.0.0.1", "::1"}:
                self._json(403, {"ok": False, "error": "로컬 요청만 허용됩니다."})
                return False
            if not is_allowed_origin(self._origin()):
                self._json(403, {"ok": False, "error": "허용되지 않은 화면입니다."})
                return False
            return True

        def do_OPTIONS(self):
            if not self._authorize():
                return
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            if self.path != "/v1/status":
                self._json(404, {"ok": False, "error": "경로를 찾을 수 없습니다."})
                return
            if not self._authorize():
                return
            try:
                status = dict(provider() or {})
            except Exception:
                status = {}
            self._json(200, {"ok": True, "bridge": "d10", **status})

        def do_POST(self):
            if self.path != "/v1/labels":
                self._json(404, {"ok": False, "error": "경로를 찾을 수 없습니다."})
                return
            if not self._authorize():
                return
            try:
                size = int(self.headers.get("Content-Length") or 0)
                if size <= 0 or size > MAX_REQUEST_BYTES:
                    raise LabelBridgeRequestError("라벨 요청 크기가 올바르지 않습니다.")
                payload = json.loads(self.rfile.read(size).decode("utf-8"))
                labels = normalize_label_request(payload)
                accepted = enqueue_labels(labels)
                accepted = len(labels) if accepted is None else int(accepted)
                if accepted != len(labels):
                    raise RuntimeError("일부 라벨을 대기열에 추가하지 못했습니다.")
                self._json(202, {"ok": True, "accepted": accepted})
            except (LabelBridgeRequestError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                self._json(400, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc) or "D10 대기열 오류"})

    server = ThreadingHTTPServer((host, int(port)), Handler)
    server.daemon_threads = True
    thread = threading.Thread(
        target=server.serve_forever,
        daemon=True,
        name="D10LabelPrintBridge",
    )
    thread.start()
    return LabelPrintBridge(server, thread)
