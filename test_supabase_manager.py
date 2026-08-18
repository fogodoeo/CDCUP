import unittest

from supabase_manager import SupabaseWorksheet


class SupabaseManagerContractTests(unittest.TestCase):
    def test_status_cleanup_uses_shared_fail_closed_lifecycle(self):
        worksheet = SupabaseWorksheet(object())
        self.assertEqual(worksheet.clean_status_value("sold"), "낙찰")
        self.assertEqual(worksheet.clean_status_value("완료"), "낙찰")
        self.assertEqual(worksheet.clean_status_value("unsold"), "유찰")
        self.assertEqual(worksheet.clean_status_value("active"), "진행중")
        self.assertEqual(worksheet.clean_status_value("깨진-임의값"), "대기")
        self.assertEqual(worksheet.clean_status_value(None), "대기")


if __name__ == "__main__":
    unittest.main()
