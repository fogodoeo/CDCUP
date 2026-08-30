import http.client
import json
import unittest

from label_print_bridge import (
    LabelBridgeRequestError,
    normalize_label_request,
    start_label_print_bridge,
)


class LabelPrintBridgeTest(unittest.TestCase):
    def test_shipping_label_maps_to_existing_contact_layout(self):
        jobs = normalize_label_request({
            "labels": [{
                "lot_number": "A01",
                "winner_name": "김미옥",
                "winner_phone": "010-1234-5678",
                "destination": "대구 크레오",
            }]
        })
        self.assertEqual(jobs, [{
            "num": "A01",
            "item_name": "대구 크레오",
            "winner_name": "김미옥",
            "winner_phone": "01012345678",
            "sold_price": "",
            "company": "",
            "label_layout": "contact",
        }])

    def test_missing_destination_is_rejected(self):
        with self.assertRaises(LabelBridgeRequestError):
            normalize_label_request({
                "labels": [{"winner_name": "김미옥", "winner_phone": "01012345678"}]
            })

    def test_loopback_server_accepts_creok_batch_and_rejects_other_origins(self):
        received = []
        bridge = start_label_print_bridge(
            lambda labels: received.extend(labels) or len(labels),
            port=0,
        )
        try:
            body = json.dumps({
                "labels": [{
                    "lot_number": "B02",
                    "winner_name": "테스트",
                    "winner_phone": "01022222222",
                    "destination": "파르게 · 경기 화성",
                }]
            }, ensure_ascii=False).encode("utf-8")
            connection = http.client.HTTPConnection("127.0.0.1", bridge.port, timeout=3)
            connection.request(
                "POST",
                "/v1/labels",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Origin": "https://creok.onrender.com",
                },
            )
            response = connection.getresponse()
            payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(response.status, 202)
            self.assertEqual(payload["accepted"], 1)
            self.assertEqual(received[0]["label_layout"], "contact")

            connection = http.client.HTTPConnection("127.0.0.1", bridge.port, timeout=3)
            connection.request(
                "POST",
                "/v1/labels",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Origin": "https://example.com",
                },
            )
            response = connection.getresponse()
            response.read()
            self.assertEqual(response.status, 403)
            self.assertEqual(len(received), 1)
        finally:
            bridge.shutdown()


if __name__ == "__main__":
    unittest.main()
