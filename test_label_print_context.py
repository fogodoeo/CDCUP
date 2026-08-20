import unittest

import band_monitor_app as app


class LabelPrintContextTests(unittest.TestCase):
    def test_numeric_auction_values_do_not_crash_label_preparation(self):
        item = {
            "status": app._core.S_SOLD,
            "startPrice": 10,
            "sold_price": 25,
            "winner": "테스터",
            "winner_phone": 1012345678,
        }

        context = app._core.MainWindow._build_label_print_context(None, item)

        self.assertEqual(context["price_text"], "25")
        self.assertEqual(context["line2"], "테스터")
        self.assertEqual(context["line3"], "1012345678")

    def test_camel_case_sold_price_is_supported(self):
        item = {
            "status": app._core.S_SOLD,
            "startPrice": 10,
            "soldPrice": 35,
            "winner": "테스터",
        }

        context = app._core.MainWindow._build_label_print_context(None, item)

        self.assertEqual(context["price_text"], "35")


if __name__ == "__main__":
    unittest.main()
