import unittest

import band_monitor_app as app


class QuickEditDraftTests(unittest.TestCase):
    def test_gender_and_note_draft_preserves_shared_routing_metadata(self):
        item = {
            "row": "lot-1",
            "name": "기존 개체",
            "note": "",
            "checklist": "gender:U|weight:3|_auction:single|sale_mode:quiz|custom:value",
        }

        draft = app._quick_edit_draft(item, "수정 개체", "M", "3.2g", "새 비고")

        self.assertEqual(draft["name"], "수정 개체")
        self.assertEqual(draft["note"], "새 비고")
        self.assertIn("gender:M", draft["checklist"])
        self.assertIn("weight:3.2", draft["checklist"])
        self.assertIn("_auction:single", draft["checklist"])
        self.assertIn("sale_mode:quiz", draft["checklist"])
        self.assertIn("custom:value", draft["checklist"])
        self.assertNotIn("gender:U", draft["checklist"])

    def test_authoritative_refresh_acknowledges_only_the_same_draft(self):
        draft = {
            "name": "수정 개체",
            "note": "새 비고",
            "checklist": "gender:M|weight:3.2",
        }
        self.assertTrue(app._quick_draft_matches(dict(draft), draft))
        self.assertFalse(app._quick_draft_matches({**draft, "checklist": "gender:U|weight:3.2"}, draft))


if __name__ == "__main__":
    unittest.main()
