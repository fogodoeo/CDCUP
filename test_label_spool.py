import json
from pathlib import Path
import tempfile
import threading
import unittest

from label_spool import LabelSpool, label_display_text


class LabelSpoolTests(unittest.TestCase):
    def test_history_is_bounded_and_display_text_is_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = LabelSpool(Path(directory) / "spool.json")
            for index in range(5):
                spool.append({"id": str(index), "status": "done", "created_at": "now", "payload": {"num": index, "item_name": "개체"}}, max_jobs=3)
            jobs = spool.load()["jobs"]
            self.assertEqual([job["id"] for job in jobs], ["2", "3", "4"])
            self.assertIn("[완료] #4 개체", label_display_text(jobs[-1]))

    def test_append_and_update_are_atomic_with_concurrent_ui_callbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spool.json"
            spool = LabelSpool(path)
            threads = [threading.Thread(target=spool.append, args=({"id": str(index), "status": "queued"},)) for index in range(20)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(len(spool.load()["jobs"]), 20)
            self.assertEqual(spool.update("10", status="done")["status"], "done")
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["jobs"][10]["status"], "done")

    def test_corrupt_partial_file_fails_closed_to_empty_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spool.json"
            path.write_text('{"jobs": [', encoding="utf-8")
            spool = LabelSpool(path, sleep_func=lambda _seconds: None)
            self.assertEqual(spool.load()["jobs"], [])


if __name__ == "__main__":
    unittest.main()
