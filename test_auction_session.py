import os
import tempfile
import threading
import unittest
from unittest import mock

import band_monitor_app as app


class _Manager:
    channel_id = "cdcup"

    def __init__(self):
        self.updated = []
        self.event = threading.Event()

    def update_item(self, payload):
        self.updated.append(dict(payload))
        self.event.set()
        return True


class _Window:
    def __init__(self):
        self.sheets = _Manager()


class ActiveAuctionSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.session_path = os.path.join(self.temp.name, "active.json")
        self.path_patch = mock.patch.object(app, "ACTIVE_AUCTION_SESSION_PATH", self.session_path)
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp.cleanup()

    def test_waiting_item_is_restored_and_repaired_remotely(self):
        window = _Window()
        item = {"row": 386, "num": 7, "name": "G01", "status": app._core.S_ACTIVE, "start_time": "20:50:45"}
        app._save_active_auction_session(window, item)
        loaded = [{**item, "status": app._core.S_WAIT}]

        restored = app._restore_active_auction_session(window, loaded)

        self.assertIs(restored, loaded[0])
        self.assertEqual(restored["status"], app._core.S_ACTIVE)
        self.assertTrue(window.sheets.event.wait(1))
        self.assertEqual(window.sheets.updated[0]["row"], 386)
        self.assertEqual(window.sheets.updated[0]["status"], app._core.S_ACTIVE)

    def test_terminal_item_clears_stale_session(self):
        window = _Window()
        item = {"row": 386, "num": 7, "name": "G01", "status": app._core.S_ACTIVE}
        app._save_active_auction_session(window, item)

        restored = app._restore_active_auction_session(
            window,
            [{**item, "status": app._core.S_SOLD}],
        )

        self.assertIsNone(restored)
        self.assertFalse(os.path.exists(self.session_path))

    def test_authoritative_status_rejects_a_stale_local_active_item(self):
        active = {"row": "creyon_lot_13", "status": app._core.S_ACTIVE}
        remote = [
            {"row": "creyon_lot_13", "status": app._core.S_SOLD},
            {"row": "creyon_lot_16", "status": app._core.S_ACTIVE},
        ]

        self.assertFalse(app._active_item_is_authoritative(active, remote))
        self.assertTrue(app._active_item_is_authoritative(remote[1], remote))


if __name__ == "__main__":
    unittest.main()
