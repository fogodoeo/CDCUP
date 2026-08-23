import queue
import threading
import time
import unittest
from types import SimpleNamespace

import band_monitor_app as app


class ChatCopyTests(unittest.TestCase):
    def test_same_chat_from_websocket_and_dom_is_processed_once(self):
        owner = SimpleNamespace(_recent_chat_transport_fingerprints={})
        websocket = {
            "name": "테스트/01022222222",
            "text": "21",
            "messageKey": "ws:member-1:1000:21",
        }
        dom_recovery = {
            "name": "테스트/01022222222",
            "text": "21",
            "messageKey": "node:17:0:테스트/01022222222:오후 2:34:21",
        }

        self.assertFalse(app._is_cross_transport_chat_duplicate(owner, websocket, now=10))
        self.assertTrue(app._is_cross_transport_chat_duplicate(owner, dom_recovery, now=11))

    def test_distinct_same_source_messages_are_not_collapsed(self):
        owner = SimpleNamespace(_recent_chat_transport_fingerprints={})
        first = {"name": "테스트", "text": "21", "messageKey": "ws:u:1000:21"}
        second = {"name": "테스트", "text": "21", "messageKey": "ws:u:1001:21"}

        self.assertFalse(app._is_cross_transport_chat_duplicate(owner, first, now=10))
        self.assertFalse(app._is_cross_transport_chat_duplicate(owner, second, now=11))

    def test_cross_transport_fingerprint_expires(self):
        owner = SimpleNamespace(_recent_chat_transport_fingerprints={})
        websocket = {"name": "테스트", "text": "21", "messageKey": "ws:u:1000:21"}
        later_dom = {"name": "테스트", "text": "21", "messageKey": "node:31:0:테스트:21"}

        self.assertFalse(app._is_cross_transport_chat_duplicate(owner, websocket, now=10))
        self.assertFalse(app._is_cross_transport_chat_duplicate(owner, later_dom, now=19))

    def test_mobile_copy_removes_layout_padding_and_splits_lines(self):
        self.assertEqual(
            app._chat_message_parts("⠀⠀🟢 낙찰 A01\\n┃ 10만원   김상정⠀⠀"),
            ("🟢 낙찰 A01", "10만원 김상정"),
        )

    def test_known_legacy_templates_upgrade_but_custom_copy_is_preserved(self):
        config = {
            "templates": {
                "start": "#{num} {name} 경매 시작! 시작가 {price}만",
                "sold": r"⠀⠀🟢 낙찰 {name}\n⠀⠀ㅤ  {sold_price}만원 {winner}",
                "unsold": "내 유찰 문구",
                "highest": "⠀⠀🔴 입찰 {sold_price}만원 {winner}⠀⠀",
            }
        }

        templates = app._apply_compact_chat_templates(config)

        self.assertEqual(templates["start"], app.CHAT_TEMPLATE_DEFAULTS["start"])
        self.assertEqual(templates["sold"], app.CHAT_TEMPLATE_DEFAULTS["sold"])
        self.assertEqual(templates["highest"], app.CHAT_TEMPLATE_DEFAULTS["highest"])
        self.assertEqual(templates["unsold"], "내 유찰 문구")

    def test_patched_queue_enqueues_each_line_as_an_independent_message(self):
        owner = SimpleNamespace(
            _chat_send_queue=queue.Queue(),
            _chat_message_batch_lock=threading.Lock(),
            _chat_batch_interval=0,
        )

        app._core.MainWindow._queue_chat_send(
            owner,
            "📢 김상정 15만원 낙찰 🔴\n📢 룰렛 참여하려면 ‘네’ 입력\n📢 룰렛 결과는 기여도만 적용",
            "전송 실패",
        )
        owner._chat_message_batch_jobs.join()

        queued = [owner._chat_send_queue.get_nowait() for _ in range(3)]
        self.assertEqual(queued, [
            ("📢 김상정 15만원 낙찰 🔴", "전송 실패"),
            ("📢 룰렛 참여하려면 ‘네’ 입력", "전송 실패"),
            ("📢 룰렛 결과는 기여도만 적용", "전송 실패"),
        ])

    def test_concurrent_message_batches_never_interleave(self):
        class SlowQueue:
            def __init__(self):
                self.rows = []

            def put(self, value):
                self.rows.append(value)
                time.sleep(0.002)

        target = SlowQueue()
        owner = SimpleNamespace(
            _chat_send_queue=target,
            _chat_message_batch_lock=threading.Lock(),
            _chat_batch_interval=0,
        )
        gate = threading.Barrier(3)

        def send(prefix):
            gate.wait()
            app._core.MainWindow._queue_chat_send(
                owner,
                f"{prefix}1\n{prefix}2\n{prefix}3",
                f"{prefix} 실패",
            )

        threads = [threading.Thread(target=send, args=(prefix,)) for prefix in ("A", "B")]
        for thread in threads:
            thread.start()
        gate.wait()
        for thread in threads:
            thread.join()
        owner._chat_message_batch_jobs.join()

        labels = [row[0][0] for row in target.rows]
        self.assertIn(labels, [list("AAABBB"), list("BBBAAA")])

    def test_static_default_copy_is_one_line_and_short(self):
        for template in app.CHAT_TEMPLATE_DEFAULTS.values():
            self.assertEqual(app._chat_message_parts(template), (template,))
            self.assertLessEqual(len(template), 34)


if __name__ == "__main__":
    unittest.main()
