import unittest

import auction_contract as contract


class AuctionContractTests(unittest.TestCase):
    def test_status_aliases_share_one_lifecycle(self):
        for value in ("낙찰", "낙찰-대기", "낙찰-입금완료", "완료", "sold"):
            self.assertEqual(contract.normalize_status(value), contract.SOLD)
            self.assertTrue(contract.is_terminal_status(value))
        for value in ("진행", "진행중", "경매중", "active", "live"):
            self.assertEqual(contract.normalize_status(value), contract.LIVE)
            self.assertFalse(contract.is_terminal_status(value))
        for value in ("유찰", "unsold", "passed"):
            self.assertEqual(contract.normalize_status(value), contract.PASSED)

    def test_amount_units_are_explicit(self):
        self.assertEqual(contract.parse_amount("1,234.5만원"), 1234.5)
        self.assertEqual(contract.to_manwon(120000), 12)
        self.assertEqual(contract.to_won(12), 120000)

    def test_checklist_metadata_preserves_round_identity(self):
        self.assertEqual(contract.checklist_meta({
            "num": 17,
            "checklist": "_auction:tournament|_label:17|_stage:4|_slot:A3|_team:A",
        }), {
            "auction_type": "tournament",
            "visibility_mode": "",
            "tournament_code": "A3",
            "team_code": "A",
            "tournament_stage": 4,
            "public_number": 17,
        })


if __name__ == "__main__":
    unittest.main()
