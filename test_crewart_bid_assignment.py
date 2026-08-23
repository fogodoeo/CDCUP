import unittest
from types import SimpleNamespace

import band_monitor_app as app


class CrewartBidAssignmentTests(unittest.TestCase):
    def test_invisible_band_markers_are_removed_from_bidder_names(self):
        self.assertEqual(app._normalize_winner_text("\u200c김상정\ufeff/대구"), "김상정/대구")
        self.assertEqual(app._normalize_winner_text("\u200c\u200b"), "")

    def test_band_acknowledgement_hides_phone_and_keeps_name_region_amount(self):
        message = app._format_crewart_assignment_chat(
            "김상정/대구/01012345678", 3, "🎲 신규 배정"
        )
        self.assertEqual(message, "📢 김상정 대구 3만원 입찰")
        self.assertNotIn("01012345678", message)

    def test_existing_assignment_uses_one_final_house_marker(self):
        message = app._format_crewart_assignment_chat("김상정/대구/12345678", 5, "🔴")
        self.assertEqual(message, "📢 김상정 대구 5만원 입찰 🔴")
        self.assertNotIn("12345678", message)

    def test_new_random_assignment_chat_stays_pending_until_broadcast_reveal(self):
        message = app._format_crewart_assignment_chat(
            "김상정/대구/01012345678", 3, "[랜덤배정중]"
        )
        self.assertEqual(message, "📢 김상정 대구 3만원 입찰 [랜덤배정중]")
        self.assertNotRegex(message, "[🔴🟢🔵🟡]")

    def test_sold_notice_is_three_independent_mobile_messages(self):
        message = app._format_crewart_sold_chat("김상정/대구/01012345678", 15, "R")
        self.assertEqual(message.splitlines(), [
            "📢 김상정 대구 15만원 낙찰 🔴",
            "📢 룰렛 참여하려면 ‘네’ 입력",
            "📢 룰렛 결과는 기여도만 적용",
        ])
        self.assertNotIn("01012345678", message)
        self.assertTrue(all(len(line) <= 34 for line in message.splitlines()))

    def test_sold_notice_is_required_even_outside_generic_auto_chat(self):
        queued = []
        owner = SimpleNamespace(
            _queue_chat_send=lambda message, label: queued.append((message, label))
        )

        message = app._queue_required_crewart_sold_guidance(
            owner,
            "김상정/대구/01012345678",
            15,
            "R",
        )

        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0][0], message)
        self.assertEqual(len(app._chat_message_parts(message)), 3)
        self.assertIn("룰렛 참여하려면 ‘네’ 입력", message)

    def test_mobile_chat_batch_is_spaced_and_keeps_fifo_order(self):
        sent = []
        sleeps = []
        app._dispatch_chat_batch(
            lambda owner, text, label: sent.append((text, label)),
            object(),
            ("첫 문장", "둘째 문장", "셋째 문장"),
            "테스트 실패",
            sleep_fn=sleeps.append,
            interval=0.7,
        )
        self.assertEqual([entry[0] for entry in sent], ["첫 문장", "둘째 문장", "셋째 문장"])
        self.assertEqual(sleeps, [0.7, 0.7])

    def test_only_the_exact_roulette_command_is_accepted(self):
        self.assertTrue(app._is_crewart_roulette_text(" 네 "))
        self.assertFalse(app._is_crewart_roulette_text("네!"))
        self.assertFalse(app._is_crewart_roulette_text("네 룰렛"))

    def test_websocket_and_dom_copy_of_same_command_is_suppressed_once(self):
        owner = SimpleNamespace()
        self.assertFalse(app._is_recent_crewart_command_duplicate(owner, "민우/대구", "네", now=10))
        self.assertTrue(app._is_recent_crewart_command_duplicate(owner, "민우/대구", " 네 ", now=12))
        self.assertFalse(app._is_recent_crewart_command_duplicate(owner, "민우/대구", "네", now=16))

    def test_different_bidder_commands_keep_fifo_entries(self):
        owner = SimpleNamespace()
        self.assertFalse(app._is_recent_crewart_command_duplicate(owner, "민우", "네", now=10))
        self.assertFalse(app._is_recent_crewart_command_duplicate(owner, "김상정", "네", now=10.1))

    def test_yes_is_a_roulette_command_only_during_the_post_sale_window(self):
        owner = SimpleNamespace(
            active_item=None,
            _crewart_last_sold={
                "channel_id": "crewart",
                "item_id": "item-1",
                "winner_bidder_key": "winner-1",
            },
        )
        self.assertTrue(app._crewart_roulette_window_open(owner))
        owner.active_item = {"row": "item-2"}
        self.assertFalse(app._crewart_roulette_window_open(owner))
        owner.active_item = None
        owner._crewart_last_sold = None
        self.assertFalse(app._crewart_roulette_window_open(owner))

    def test_roulette_start_notice_hides_phone_and_names_the_winner(self):
        message = app._format_crewart_roulette_start_chat("김상정/대구/01012345678")
        self.assertEqual(message, "📢 김상정 대구 룰렛 시작")
        self.assertNotIn("01012345678", message)

    def test_websocket_key_and_dom_profile_are_the_same_winner(self):
        context = {
            "winner_bidder_key": "7V25Q3SJ5HGELA3HSKCOPYPI5Q======",
            "winner_name": "테스트/01022222222",
            "winner_aliases": tuple(app._crewart_identity_aliases(
                "7V25Q3SJ5HGELA3HSKCOPYPI5Q======",
                "테스트/01022222222",
            )),
        }
        self.assertTrue(app._crewart_roulette_candidate_is_winner(
            context,
            "7V25Q3SJ5HGELA3HSKCOPYPI5Q======",
            "테스트",
        ))
        self.assertTrue(app._crewart_roulette_candidate_is_winner(
            context,
            "테스트/01022222222",
            "테스트/01022222222",
        ))
        self.assertFalse(app._crewart_roulette_candidate_is_winner(
            context,
            "another-user",
            "다른사람/01099999999",
        ))

    def test_one_yes_seen_by_websocket_and_dom_reserves_only_one_roulette(self):
        winner_key = "7V25Q3SJ5HGELA3HSKCOPYPI5Q======"
        context = {
            "winner_bidder_key": winner_key,
            "winner_name": "테스트/01022222222",
            "winner_aliases": tuple(app._crewart_identity_aliases(
                winner_key,
                "테스트/01022222222",
            )),
            "roulette_state": "idle",
        }
        first = app._reserve_crewart_roulette_candidate(context, winner_key, "테스트")
        copied = app._reserve_crewart_roulette_candidate(
            context,
            "테스트/01022222222",
            "테스트/01022222222",
        )
        self.assertEqual(first, ("queued", winner_key, True))
        self.assertEqual(copied, ("duplicate", winner_key, True))
        self.assertEqual(context["roulette_state"], "queued")

    def test_other_members_yes_is_normal_chat_without_roulette_reply(self):
        context = {
            "winner_bidder_key": "winner-1",
            "winner_name": "민우/01022222222",
            "winner_aliases": tuple(app._crewart_identity_aliases(
                "winner-1",
                "민우/01022222222",
            )),
            "roulette_state": "idle",
        }

        result = app._reserve_crewart_roulette_candidate(
            context,
            "member-2",
            "김상정/01099999999",
        )

        self.assertEqual(result, ("not-winner", "member-2", False))
        self.assertEqual(context["roulette_state"], "idle")
        with open(app.__file__, "r", encoding="utf-8") as source_file:
            source = source_file.read()
        self.assertIn('if queue_status == "not-winner":', source)
        self.assertIn("self.chat_w.append_msg(name, display_text, t, False)", source)

    def test_assignment_result_is_reused_for_the_winner_house_marker(self):
        owner = SimpleNamespace(
            active_item={
                "row": "item-1",
                "bids": [{"bidder_key": "winner-1", "name": "김상정", "amount": 15}],
            },
            sheets=SimpleNamespace(channel_id="crewart"),
        )
        job = {
            "channel_id": "crewart",
            "item_id": "item-1",
            "bidder_key": "winner-1",
        }

        self.assertEqual(app._remember_crewart_house(owner, job, {"houseKey": "g"}), "G")
        winner_bid = owner.active_item["bids"][0]
        self.assertEqual(winner_bid["crewart_house_key"], "G")
        self.assertEqual(
            app._crewart_winner_house(owner, owner.active_item, winner_bid),
            "G",
        )
        self.assertEqual(
            app._format_crewart_sold_chat("김상정", 15, "G").splitlines()[0],
            "📢 김상정 15만원 낙찰 🟢",
        )

    def test_server_frozen_winner_house_is_used_when_local_assignment_is_late(self):
        owner = SimpleNamespace(sheets=SimpleNamespace(channel_id="crewart"))
        item = {
            "row": "item-1",
            "attributes": {"crewart_house_key": "Y"},
        }
        self.assertEqual(app._crewart_winner_house(owner, item, {}), "Y")
        self.assertEqual(
            app._format_crewart_sold_chat("민우", 1, "Y").splitlines()[0],
            "📢 민우 1만원 낙찰 🟡",
        )

    def test_desktop_source_preserves_fifo_and_idempotency_metadata(self):
        with open(app.__file__, "r", encoding="utf-8") as source_file:
            source = source_file.read()
        self.assertIn("self._crewart_assignment_jobs = queue.Queue()", source)
        self.assertIn('"message_key"', source)
        self.assertIn('"bid_sequence"', source)
        self.assertIn('name="CrewartAssignment"', source)
        self.assertIn('name="CrewartContributionRoulette"', source)
        self.assertIn("sheets.trigger_audience_roulette", source)
        self.assertIn("for attempt in range(3):", source)
        self.assertIn("time.sleep(0.4 * (attempt + 1))", source)
        self.assertIn('"roulette_state": "idle"', source)
        self.assertIn("_format_crewart_roulette_start_chat(job.get(\"name\"))", source)
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

    def test_post_sale_roulette_window_restores_after_monitor_restart(self):
        manager = SimpleNamespace(
            channel_id="crewart",
            using_platform=True,
            channel={
                "audienceCompetition": {
                    "enabled": True,
                    "assignment": "survey-random",
                }
            },
            broadcast_state={"mode": "sold", "activeItemId": "item-1"},
        )
        owner = SimpleNamespace(
            sheets=manager,
            active_item=None,
            _crewart_last_sold=None,
            _normalize_bid_entries=lambda bids: list(bids),
        )
        items = [{
            "row": "item-1",
            "status": app._core.S_SOLD,
            "winner": "민우",
            "bids": [{"name": "민우/01012345678", "bidder_key": "member-1", "amount": 10}],
            "attributes": {"crewart_roulette_status": "unused"},
        }]

        self.assertTrue(app._restore_crewart_last_sold_context(owner, items))
        self.assertTrue(app._crewart_roulette_window_open(owner))
        self.assertEqual(owner._crewart_last_sold["winner_bidder_key"], "member-1")
        self.assertEqual(owner._crewart_last_sold["roulette_state"], "idle")

    def test_post_sale_recovery_refuses_a_different_or_live_item(self):
        manager = SimpleNamespace(
            channel_id="crewart",
            using_platform=True,
            channel={"audienceCompetition": {"enabled": True, "assignment": "survey-random"}},
            broadcast_state={"mode": "sold", "activeItemId": "item-2"},
        )
        owner = SimpleNamespace(
            sheets=manager,
            active_item=None,
            _crewart_last_sold=None,
            _normalize_bid_entries=lambda bids: list(bids),
        )
        stale = [{
            "row": "item-1",
            "status": app._core.S_SOLD,
            "bids": [{"name": "민우", "bidder_key": "member-1", "amount": 10}],
        }]
        self.assertFalse(app._restore_crewart_last_sold_context(owner, stale))
        owner.active_item = {"row": "item-3"}
        self.assertFalse(app._restore_crewart_last_sold_context(owner, stale))

    def test_queued_roulette_job_drops_at_item_channel_and_next_auction_boundaries(self):
        context = {"item_id": "item-1", "roulette_state": "queued"}
        owner = SimpleNamespace(
            sheets=SimpleNamespace(channel_id="crewart"),
            active_item=None,
            _crewart_last_sold=context,
        )
        job = {"channel_id": "crewart", "item_id": "item-1", "winner_match": True}
        self.assertTrue(app._crewart_roulette_job_is_current(owner, job))
        owner.active_item = {"row": "item-2"}
        self.assertFalse(app._crewart_roulette_job_is_current(owner, job))
        owner.active_item = None
        owner.sheets.channel_id = "creyon"
        self.assertFalse(app._crewart_roulette_job_is_current(owner, job))
        owner.sheets.channel_id = "crewart"
        owner._crewart_last_sold = {"item_id": "item-2", "roulette_state": "queued"}
        self.assertFalse(app._crewart_roulette_job_is_current(owner, job))


if __name__ == "__main__":
    unittest.main()
