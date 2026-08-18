import unittest

from capture_client import CaptureClient, CaptureConfigurationError, build_capture_payload


class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body or {}

    def raise_for_status(self):
        if not 200 <= self.status_code < 300:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._body


class CaptureClientTests(unittest.TestCase):
    def test_manual_and_closing_capture_have_stable_dedupe_rules(self):
        item = {"row": 42, "num": 7, "name": "개체", "company": "업체", "start_time": "start-1"}
        manual = build_capture_payload(item, manual=True, event_nonce=123, channel_id="auto")
        closing = build_capture_payload(item, sold_price="15", winner="구매자", channel_id="cdcup")
        self.assertEqual(manual["eventKey"], "42:manual:123")
        self.assertFalse(manual["skipIfCaptured"])
        self.assertEqual(closing["eventKey"], "42:sold:start-1:15:구매자")
        self.assertTrue(closing["skipIfCaptured"])
        self.assertEqual(closing["channelId"], "cdcup")

    def test_missing_credentials_fail_before_network(self):
        calls = []
        client = CaptureClient("https://example.test", "", request_func=lambda *args, **kwargs: calls.append((args, kwargs)))
        with self.assertRaises(CaptureConfigurationError):
            client.check()
        self.assertEqual(calls, [])

    def test_queue_retries_then_returns_server_result(self):
        calls = []
        sleeps = []

        def request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if len(calls) < 3:
                return FakeResponse(503)
            return FakeResponse(201, {"job": {"status": "pending"}})

        client = CaptureClient("https://example.test/", "secret", request_func=request, sleep_func=sleeps.append)
        result = client.queue({"itemId": "one"})
        self.assertEqual(result["job"]["status"], "pending")
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [1.0, 2.0])
        self.assertEqual(calls[0][2]["headers"]["X-Creo-Capture-Token"], "secret")


if __name__ == "__main__":
    unittest.main()
