import unittest
from types import SimpleNamespace

import band_monitor_app as app


class BuyNowModeTests(unittest.TestCase):
    class _Button:
        def __init__(self):
            self.text = ""
            self.enabled = True
            self.tooltip = ""
            self.visible = True

        def setText(self, value):
            self.text = value

        def setEnabled(self, value):
            self.enabled = bool(value)

        def setToolTip(self, value):
            self.tooltip = value

        def setVisible(self, value):
            self.visible = bool(value)

        def setStyleSheet(self, _value):
            pass

    def test_crewart_channel_ignores_copied_tournament_metadata(self):
        item = {
            "name": "A01",
            "checklist": "weight:42|_auction:tournament|_stage:4|_slot:A1|_team:A",
        }
        crewart = SimpleNamespace(
            using_platform=True,
            channel={"id": "crewart", "features": {"tournament": False}},
        )
        cdcup_copy = SimpleNamespace(
            using_platform=True,
            channel={"id": "team-cup", "features": {"tournament": True}},
        )

        self.assertEqual(app._competition_mode(item, crewart), "single")
        self.assertEqual(app._competition_mode(item, cdcup_copy), "tournament")

    def buy_now_item(self):
        checklist = app._replace_sale_mode_checklist(
            "gender:U|custom:keep",
            "buy_now",
            {"instant_price": "10"},
        )
        return {"row": "item-1", "num": 1, "name": "즉구 개체", "checklist": checklist}

    def test_buy_now_configuration_round_trips_without_losing_metadata(self):
        item = self.buy_now_item()
        meta = app._buy_now_item_meta(item)
        self.assertTrue(meta["is_buy_now"])
        self.assertEqual(meta["instant_price"], "10")
        self.assertIn("custom:keep", item["checklist"])

    def test_band_marker_is_the_acceptance_boundary(self):
        item = self.buy_now_item()
        marker = app._format_buy_now_announcement(10)
        owner = SimpleNamespace(
            active_item=item,
            _buy_now_state=app.BUY_NOW_PENDING,
            _buy_now_item_key="item-1",
            _buy_now_marker_text=marker,
        )
        self.assertFalse(app._activate_buy_now_boundary(owner, "즉구"))
        self.assertEqual(owner._buy_now_state, app.BUY_NOW_PENDING)
        self.assertTrue(app._activate_buy_now_boundary(owner, marker))
        self.assertEqual(owner._buy_now_state, app.BUY_NOW_ACTIVE)

    def test_only_first_buy_now_message_can_claim_the_item(self):
        owner = SimpleNamespace(
            active_item=self.buy_now_item(),
            _buy_now_state=app.BUY_NOW_ACTIVE,
            _buy_now_item_key="item-1",
        )
        self.assertTrue(app._claim_buy_now(owner))
        self.assertEqual(owner._buy_now_state, app.BUY_NOW_CLAIMING)
        self.assertFalse(app._claim_buy_now(owner))

    def test_reordered_or_next_item_claim_fails_closed(self):
        owner = SimpleNamespace(
            active_item={**self.buy_now_item(), "row": "item-2"},
            _buy_now_state=app.BUY_NOW_ACTIVE,
            _buy_now_item_key="item-1",
        )
        self.assertFalse(app._claim_buy_now(owner))

    def test_first_claim_uses_fixed_price_and_waits_for_operator_confirmation(self):
        calls = []
        card = SimpleNamespace(
            btn_sold=self._Button(),
            btn_countdown=self._Button(),
        )
        owner = SimpleNamespace(
            active_item=self.buy_now_item(),
            _buy_now_state=app.BUY_NOW_ACTIVE,
            _buy_now_item_key="item-1",
            auction_card=card,
            _auction_countdown_state=app.AUCTION_COUNTDOWN_IDLE,
            _auction_countdown_late_bids=[],
            toast=SimpleNamespace(show_toast=lambda *args: calls.append(("toast", args))),
            _add_bid=lambda name, amount, t, bidder_key: calls.append(("bid", name, amount, bidder_key)) or True,
            _normalize_bid_entries=lambda bids: list(bids or []),
        )
        method = app._core.MainWindow._complete_buy_now_claim
        self.assertTrue(method(owner, "민우/대구", bidder_key="user-1", message_key="message-1"))
        self.assertIn(("bid", "민우/대구", 10.0, "user-1"), calls)
        self.assertFalse(any(call[0] in {"end", "print"} for call in calls))
        self.assertEqual(owner._buy_now_state, app.BUY_NOW_CLAIMED)
        self.assertEqual(card.btn_sold.text, "즉구 완료")
        self.assertTrue(card.btn_sold.enabled)
        self.assertEqual(card.btn_countdown.text, "즉구 접수됨")
        self.assertFalse(card.btn_countdown.enabled)
        self.assertFalse(method(owner, "다음사람", bidder_key="user-2", message_key="message-2"))

    def test_claimed_buy_now_restores_after_reload_and_enables_confirmation(self):
        item = {
            **self.buy_now_item(),
            "bids": [{"name": "민우/대구", "amount": 10, "bidderKey": "user-1"}],
        }
        card = SimpleNamespace(btn_sold=self._Button(), btn_countdown=self._Button())
        owner = SimpleNamespace(
            active_item=item,
            auction_card=card,
            _buy_now_state=app.BUY_NOW_IDLE,
            _buy_now_item_key="",
            _auction_countdown_state=app.AUCTION_COUNTDOWN_IDLE,
            _auction_countdown_late_bids=[],
            _normalize_bid_entries=lambda bids: list(bids or []),
        )

        self.assertTrue(app._core.MainWindow._restore_buy_now_claim_from_item(owner, item))
        app._core.MainWindow._apply_auction_card_mode(owner, item)
        self.assertEqual(owner._buy_now_state, app.BUY_NOW_CLAIMED)
        self.assertTrue(card.btn_sold.enabled)
        self.assertEqual(card.btn_sold.text, "즉구 완료")

    def test_announcement_is_clear_and_contains_the_fixed_price(self):
        message = app._format_buy_now_announcement(10)
        self.assertEqual(message, "📢 첫 ‘즉구’ 10만원 입찰 접수")
        self.assertNotIn("\n", message)

    def test_switching_from_buy_now_to_general_restores_countdown_action(self):
        card = SimpleNamespace(
            btn_sold=self._Button(),
            btn_countdown=self._Button(),
        )
        owner = SimpleNamespace(
            active_item={
                "row": "item-2",
                "num": 2,
                "name": "일반 개체",
                "checklist": "",
            },
            auction_card=card,
            _buy_now_state=app.BUY_NOW_CLAIMED,
            _auction_countdown_state=app.AUCTION_COUNTDOWN_IDLE,
            _auction_countdown_late_bids=[],
        )

        app._core.MainWindow._update_auction_countdown_button(owner)

        self.assertEqual(card.btn_countdown.text, "마감 카운트")
        self.assertTrue(card.btn_countdown.enabled)

    def test_operator_buy_now_confirmation_uses_common_sold_path(self):
        item = {
            **self.buy_now_item(),
            "bids": [{"name": "민우/대구", "bidder_key": "user-1", "amount": 10}],
        }
        calls = []
        owner = SimpleNamespace(
            active_item=item,
            toast=SimpleNamespace(show_toast=lambda *args: calls.append(("toast", args))),
            _normalize_bid_entries=lambda bids: list(bids or []),
            _end_auction=lambda ended_item, status, sold_price="", winner="": (
                calls.append(("end", ended_item, status, sold_price, winner)) or True
            ),
            _maybe_auto_print_label=lambda ended_item: calls.append(("print", ended_item)),
        )

        app._core.MainWindow._on_sold(owner)

        end_call = next(call for call in calls if call[0] == "end")
        self.assertIs(end_call[1], item)
        self.assertEqual(end_call[2], app._core.S_SOLD)
        self.assertEqual(end_call[3], "10")
        self.assertEqual(end_call[4], "민우/대구")
        self.assertEqual(sum(call[0] == "end" for call in calls), 1)
        self.assertEqual(sum(call[0] == "print" for call in calls), 1)


if __name__ == "__main__":
    unittest.main()
