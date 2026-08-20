import os
import json
import types
import unittest
from collections import deque

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import band_monitor_app as app


class _Toast:
    def __init__(self):
        self.events = []

    def show_toast(self, *args):
        self.events.append(args)


class _CountdownWindow(app._core.QObject):
    def __init__(self):
        super().__init__()
        self.active_item = {
            "row": 7,
            "num": "A01",
            "bids": [
                {
                    "name": "기존 입찰자",
                    "bidder_key": "existing",
                    "amount": 10,
                    "time": "20:00",
                }
            ],
        }
        self.auction_card = types.SimpleNamespace(
            btn_countdown=app._core.QPushButton(),
            lbl_countdown_progress=app._core.QLabel(),
        )
        self.toast = _Toast()
        self.config = {"templates": {}}
        self.sent = []
        self._seen_msgs = set()
        self._seen_msg_order = deque()
        self._poll_fail = 0
        self._last_chat_mutation_seq = 0
        self._auction_start_mutation_seq = 0
        self._buy_now_key_last_item = {}
        self.poll_timer = None
        self.chat_w = types.SimpleNamespace(messages=[])
        self.chat_w.append_msg = lambda *args: self.chat_w.messages.append(args)

        method_names = (
            "_countdown_current_bids",
            "_countdown_current_top_signature",
            "_countdown_is_locked",
            "_update_auction_countdown_button",
            "_set_auction_countdown_state",
            "_stop_auction_countdown",
            "_begin_auction_countdown",
            "_advance_auction_countdown",
            "_lock_auction_bidding",
            "_confirm_auction_lock_boundary",
            "_record_locked_late_bid",
            "_accept_locked_late_bid",
            "_approve_manual_bid_and_resume",
            "_on_auction_countdown_action",
        )
        for name in method_names:
            method = getattr(app._core.MainWindow, name)
            setattr(self, name, method.__get__(self, type(self)))

    def _normalize_bid_entries(self, raw):
        return sorted(
            [dict(entry) for entry in (raw or [])],
            key=lambda entry: float(entry.get("amount", 0) or 0),
            reverse=True,
        )

    def _queue_chat_send(self, text, label):
        self.sent.append((text, label))

    def _update_status_bar(self, _status):
        return None

    def _add_bid(self, *_args, **_kwargs):
        raise AssertionError("locked chat bid must not reach _add_bid")


class AuctionCountdownTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.qt_app = app._core.QApplication.instance() or app._core.QApplication([])

    def test_countdown_contract_has_fixed_five_slots_and_expected_timing(self):
        self.assertEqual(sum(ms for _, ms in app.AUCTION_COUNTDOWN_INITIAL_STAGES), 39600)
        self.assertEqual(sum(ms for _, ms in app.AUCTION_COUNTDOWN_RESUME_STAGES), 27600)
        self.assertEqual(app.AUCTION_COUNTDOWN_FIRST_MESSAGE_DELAY_MS, 1020)
        self.assertEqual(app.AUCTION_COUNTDOWN_RESUME_DELAY_MS, 840)
        self.assertEqual(
            [ms for _, ms in app.AUCTION_COUNTDOWN_INITIAL_STAGES],
            [6000, 6000, 8400, 9600, 9600],
        )
        self.assertEqual(
            [message for message, _ in app.AUCTION_COUNTDOWN_INITIAL_STAGES],
            [
                "🟩🟩🟩🟩🟩",
                "🟩🟩🟩🟩⬜",
                "🟨🟨🟨⬜⬜",
                "🟧🟧⬜⬜⬜",
                "🟥⬜⬜⬜⬜",
            ],
        )
        self.assertEqual(app.AUCTION_COUNTDOWN_LOCK_MESSAGE, "⬜⬜⬜⬜⬜")

    def test_live_socket_with_empty_queue_recovers_new_bid_from_band_dom(self):
        class Listener:
            _total_received = 8

            @staticmethod
            def is_alive():
                return True

            @staticmethod
            def get_messages():
                return [], 8

        payload = {
            "messages": [{
                "name": "마감 후 입찰자",
                "text": "12",
                "time": "20:02",
                "userKey": "late-user",
                "messageKey": "dom:late-message",
            }],
            "messageNodeCount": 9,
            "mutationSeq": 9,
            "inputFound": True,
            "sendFound": True,
            "domReady": True,
        }
        fake_cdp = types.SimpleNamespace(
            _ws_chat_listener=Listener(),
            evaluate=lambda _script: json.dumps(payload, ensure_ascii=False),
        )

        snapshot = app._core.BandCDP.get_chat_snapshot(fake_cdp, 50)

        self.assertEqual(snapshot["messages"][0]["messageKey"], "dom:late-message")
        self.assertEqual(snapshot["mutationSeq"], 9)

    def test_action_button_is_immediately_after_sold(self):
        card = app._core.AuctionCardWidget()
        container = card.findChild(app._core.QWidget, "auctionCard")
        action_layout = None
        for index in range(container.layout().count()):
            candidate = container.layout().itemAt(index).layout()
            if candidate is not None and candidate.indexOf(card.btn_sold) >= 0:
                action_layout = candidate
                break
        self.assertIsNotNone(action_layout)
        sold_index = action_layout.indexOf(card.btn_sold)
        self.assertIs(action_layout.itemAt(sold_index + 1).widget(), card.btn_countdown)
        self.assertIs(action_layout.itemAt(sold_index + 2).widget(), card.lbl_countdown_progress)
        self.assertEqual(card.btn_countdown.text(), "마감 카운트")
        self.assertEqual(card.lbl_countdown_progress.text(), "(5/5)")

    def test_main_window_binds_countdown_button_directly(self):
        window = _CountdownWindow()
        app._core.MainWindow._init_auction_countdown(window)

        window.auction_card.btn_countdown.click()
        self.qt_app.processEvents()
        window._auction_countdown_timer.stop()

        self.assertTrue(window._auction_countdown_button_bound)
        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_RUNNING)
        self.assertEqual(window.sent[0][0], app.AUCTION_COUNTDOWN_ANNOUNCEMENT)

    def test_platform_channel_uses_the_same_countdown_contract(self):
        window = _CountdownWindow()
        window.sheets = types.SimpleNamespace(channel_id="creyon", using_platform=True)
        app._core.MainWindow._init_auction_countdown(window)

        window.auction_card.btn_countdown.click()
        self.qt_app.processEvents()
        window._auction_countdown_timer.stop()

        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_RUNNING)
        self.assertEqual(window.sent[0][0], app.AUCTION_COUNTDOWN_ANNOUNCEMENT)

    def test_restored_active_item_reenables_countdown_button(self):
        host = app._core.QMainWindow()
        card = app._core.AuctionCardWidget()
        host.setCentralWidget(card)
        host.auction_card = card
        host.active_item = {
            "row": 1,
            "num": "A01",
            "name": "A01",
            "company": "렙소디",
            "status": app._core.S_ACTIVE,
            "bids": [],
        }
        host._auction_countdown_state = app.AUCTION_COUNTDOWN_IDLE
        host._update_auction_countdown_button = (
            app._core.MainWindow._update_auction_countdown_button.__get__(host, type(host))
        )
        card.btn_countdown.setEnabled(False)

        card.show_item_detail(host.active_item)

        self.assertFalse(card.btn_countdown.isHidden())
        self.assertTrue(card.btn_countdown.isEnabled())
        self.assertEqual(card.btn_countdown.text(), "마감 카운트")

    def test_initial_countdown_locks_and_manual_change_resumes_at_yellow(self):
        window = _CountdownWindow()
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=True)
        window._auction_countdown_timer.stop()

        for _ in range(len(app.AUCTION_COUNTDOWN_INITIAL_STAGES) + 1):
            app._core.MainWindow._advance_auction_countdown(window)
            window._auction_countdown_timer.stop()

        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_LOCK_PENDING)
        self.assertEqual(window.auction_card.lbl_countdown_progress.text(), "(0/5) 마감")
        app._core.MainWindow._confirm_auction_lock_boundary(window)
        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_LOCKED)
        self.assertEqual(window.auction_card.btn_countdown.text(), "입찰 OK")
        self.assertEqual(window.sent[-1][0], app.AUCTION_COUNTDOWN_LOCK_MESSAGE)

        window.active_item["bids"].append(
            {
                "name": "수동 승인",
                "bidder_key": "manual",
                "amount": 11,
                "time": "20:01",
            }
        )
        approved = app._core.MainWindow._approve_manual_bid_and_resume(window)
        window._auction_countdown_timer.stop()

        self.assertTrue(approved)
        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_RUNNING)
        self.assertEqual(window._auction_countdown_sequence, app.AUCTION_COUNTDOWN_RESUME_STAGES)
        self.assertEqual(window.auction_card.btn_countdown.text(), "카운트 취소")

    def test_bid_during_initial_green_keeps_current_countdown_position(self):
        window = _CountdownWindow()
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=False)
        window._auction_countdown_timer.stop()
        app._core.MainWindow._advance_auction_countdown(window)
        window._auction_countdown_timer.stop()
        previous_top = app._core.MainWindow._countdown_current_top_signature(window)
        window.active_item["bids"].append(
            {"name": "새 입찰자", "bidder_key": "new", "amount": 11, "time": "20:01"}
        )

        app._core.MainWindow._restart_countdown_after_accepted_bid(window, previous_top)

        self.assertEqual(window._auction_countdown_sequence, app.AUCTION_COUNTDOWN_INITIAL_STAGES)
        self.assertEqual(window._auction_countdown_stage_index, 1)

    def test_bid_after_green_restarts_from_yellow(self):
        window = _CountdownWindow()
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=False)
        window._auction_countdown_timer.stop()
        for _ in range(3):
            app._core.MainWindow._advance_auction_countdown(window)
            window._auction_countdown_timer.stop()
        previous_top = app._core.MainWindow._countdown_current_top_signature(window)
        window.active_item["bids"].append(
            {"name": "새 입찰자", "bidder_key": "new", "amount": 11, "time": "20:01"}
        )

        app._core.MainWindow._restart_countdown_after_accepted_bid(window, previous_top)
        window._auction_countdown_timer.stop()

        self.assertEqual(window._auction_countdown_sequence, app.AUCTION_COUNTDOWN_RESUME_STAGES)
        self.assertEqual(window._auction_countdown_stage_index, 0)

    def test_manual_ok_without_changed_top_stays_locked(self):
        window = _CountdownWindow()
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=False)
        window._auction_countdown_timer.stop()
        app._core.MainWindow._lock_auction_bidding(window)
        app._core.MainWindow._confirm_auction_lock_boundary(window)

        approved = app._core.MainWindow._approve_manual_bid_and_resume(window)

        self.assertFalse(approved)
        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_LOCKED)
        self.assertTrue(window.toast.events)

    def test_chat_bid_after_blank_is_visible_but_not_applied(self):
        window = _CountdownWindow()
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=False)
        window._auction_countdown_timer.stop()
        app._core.MainWindow._lock_auction_bidding(window)
        app._core.MainWindow._confirm_auction_lock_boundary(window)

        app._core.MainWindow._on_chat_poll_done(
            window,
            {
                "msgs": [
                    {
                        "name": "늦은 입찰자",
                        "text": "11",
                        "time": "20:02",
                        "userKey": "late-user",
                        "messageKey": "late-message-1",
                    }
                ],
                "mutationSeq": 1,
                "poll_fail": 0,
            },
        )

        self.assertEqual(len(window.active_item["bids"]), 1)
        self.assertEqual(len(window._auction_countdown_late_bids), 1)
        self.assertIn("마감 후 · 미반영", window.chat_w.messages[-1][1])
        self.assertTrue(window.chat_w.messages[-1][-1])
        self.assertEqual(window.auction_card.btn_countdown.text(), "늦은 입찰 1건")

    def test_operator_can_accept_highest_late_bid_and_resume(self):
        window = _CountdownWindow()
        window._record_manual_bid = app._core.MainWindow._record_manual_bid.__get__(window, type(window))
        window._persist_bid_state_async = lambda *_args, **_kwargs: None
        window.auction_card.update_bids = lambda bids: None
        window.chat_w.append_msg = lambda *args: window.chat_w.messages.append(args)
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=False)
        window._auction_countdown_timer.stop()
        app._core.MainWindow._lock_auction_bidding(window)
        app._core.MainWindow._confirm_auction_lock_boundary(window)
        app._core.MainWindow._record_locked_late_bid(window, "늦은 11", 11, bidder_key="late-11")
        app._core.MainWindow._record_locked_late_bid(window, "늦은 12", 12, bidder_key="late-12")

        accepted = app._core.MainWindow._accept_locked_late_bid(window)
        window._auction_countdown_timer.stop()

        self.assertTrue(accepted)
        self.assertEqual(window.active_item["bids"][0]["bidder_key"], "late-12")
        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_RUNNING)
        self.assertEqual(window._auction_countdown_sequence, app.AUCTION_COUNTDOWN_RESUME_STAGES)
        self.assertEqual(window.auction_card.lbl_countdown_progress.text(), "(3/5)")

    def test_band_chat_order_around_blank_marker_is_authoritative(self):
        window = _CountdownWindow()
        app._core.MainWindow._begin_auction_countdown(window, resume=False, announce=False)
        window._auction_countdown_timer.stop()
        app._core.MainWindow._lock_auction_bidding(window)

        def accept_bid(name, amount, t="", bidder_key=""):
            window.active_item["bids"].append(
                {
                    "name": name,
                    "bidder_key": bidder_key,
                    "amount": amount,
                    "time": t,
                }
            )
            return True

        window._add_bid = accept_bid
        app._core.MainWindow._on_chat_poll_done(
            window,
            {
                "msgs": [
                    {
                        "name": "마감 전 입찰자",
                        "text": "11",
                        "time": "20:02",
                        "userKey": "before-user",
                        "messageKey": "before-message",
                    },
                    {
                        "name": "운영자",
                        "text": app.AUCTION_COUNTDOWN_LOCK_MESSAGE,
                        "time": "20:02",
                        "userKey": "operator",
                        "messageKey": "blank-marker",
                    },
                    {
                        "name": "마감 후 입찰자",
                        "text": "12",
                        "time": "20:02",
                        "userKey": "after-user",
                        "messageKey": "after-message",
                    },
                ],
                "mutationSeq": 3,
                "poll_fail": 0,
            },
        )

        accepted_keys = {bid["bidder_key"] for bid in window.active_item["bids"]}
        self.assertIn("before-user", accepted_keys)
        self.assertNotIn("after-user", accepted_keys)
        self.assertEqual(window._auction_countdown_state, app.AUCTION_COUNTDOWN_LOCKED)
        self.assertEqual(window._auction_countdown_locked_top, ("before-user", 11.0))
        self.assertEqual(len(window._auction_countdown_late_bids), 1)
        self.assertEqual(window._auction_countdown_late_bids[0]["bidder_key"], "after-user")


if __name__ == "__main__":
    unittest.main()
