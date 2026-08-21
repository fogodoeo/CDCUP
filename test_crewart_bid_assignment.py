import unittest
from types import SimpleNamespace

import band_monitor_app as app


class CrewartBidAssignmentTests(unittest.TestCase):
    def test_band_acknowledgement_hides_phone_and_keeps_name_region_amount(self):
        message = app._format_crewart_assignment_chat(
            "김상정/대구/01012345678", 3, "🎲 신규 배정"
        )
        self.assertEqual(message, "김상정 대구 3만원 입찰 🎲 신규 배정")
        self.assertNotIn("01012345678", message)

    def test_existing_assignment_uses_one_final_house_marker(self):
        message = app._format_crewart_assignment_chat("김상정/대구/12345678", 5, "🔴")
        self.assertEqual(message, "김상정 대구 5만원 입찰 🔴")
        self.assertNotIn("12345678", message)

    def test_desktop_source_preserves_fifo_and_idempotency_metadata(self):
        with open(app.__file__, "r", encoding="utf-8") as source_file:
            source = source_file.read()
        self.assertIn("self._crewart_assignment_jobs = queue.Queue()", source)
        self.assertIn('"message_key"', source)
        self.assertIn('"bid_sequence"', source)
        self.assertIn('name="CrewartAssignment"', source)
        self.assertNotIn('channel_id", "") == "crewart"', source)

    def test_assignment_job_is_dropped_after_item_or_channel_boundary(self):
        window = SimpleNamespace(
            sheets=SimpleNamespace(channel_id="crewart"),
            active_item={"row": "item-2"},
        )
        self.assertTrue(app._crewart_assignment_job_is_current(
            window, {"channel_id": "crewart", "item_id": "item-2"}
        ))
        self.assertFalse(app._crewart_assignment_job_is_current(
            window, {"channel_id": "crewart", "item_id": "item-1"}
        ))
        self.assertFalse(app._crewart_assignment_job_is_current(
            window, {"channel_id": "creyon", "item_id": "item-2"}
        ))

    def test_assignment_job_is_dropped_after_auction_ends(self):
        window = SimpleNamespace(
            sheets=SimpleNamespace(channel_id="crewart"),
            active_item=None,
        )
        self.assertFalse(app._crewart_assignment_job_is_current(
            window, {"channel_id": "crewart", "item_id": "item-1"}
        ))


if __name__ == "__main__":
    unittest.main()
