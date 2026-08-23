import unittest

import band_monitor_app as app


class NewItemHelperTests(unittest.TestCase):
    def test_next_lot_uses_largest_current_channel_number(self):
        items = [{"num": 3}, {"num": "11"}, {"num": 7}, {"num": ""}]
        self.assertEqual(app._next_item_lot_number(items), 12)
        self.assertEqual(app._next_item_lot_number([]), 1)

    def test_vendor_choices_are_unique_and_follow_lot_order(self):
        items = [
            {"num": 7, "company": "쭌이네"},
            {"num": 1, "company": " 크레용 대구 "},
            {"num": 3, "company": "쭌이네"},
            {"num": 5, "company": ""},
            {"num": 9, "company": "크레용 대구"},
        ]
        self.assertEqual(
            app._current_item_vendor_names(items),
            ["크레용 대구", "쭌이네"],
        )

    def test_general_auction_start_price_never_becomes_instant_buy_metadata(self):
        fields = app._new_item_sale_fields(
            "auction",
            start_price=3,
            instant_price=99,
        )
        meta = app._sale_item_meta({"checklist": fields["checklist"]})

        self.assertEqual(fields["price"], "3")
        self.assertEqual(meta["mode"], "auction")
        self.assertEqual(meta["config"], {})

    def test_instant_buy_price_is_separate_from_start_price(self):
        fields = app._new_item_sale_fields(
            "buy_now",
            start_price=88,
            instant_price=10,
        )
        meta = app._buy_now_item_meta({"checklist": fields["checklist"]})

        self.assertEqual(fields["price"], 0)
        self.assertTrue(meta["is_buy_now"])
        self.assertEqual(meta["instant_price"], "10")


if __name__ == "__main__":
    unittest.main()
