import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import band_monitor_app as app


class ItemDetailManagerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.qt_app = app._core.QApplication.instance() or app._core.QApplication([])

    def test_constructor_manager_is_used_without_global_window_lookup(self):
        manager = object()
        dialog = SimpleNamespace(parentWidget=lambda: None)

        self.assertIs(
            app._resolve_item_detail_manager(dialog, ({"name": "A01"}, manager, object()), {}),
            manager,
        )

    def test_parent_manager_is_safe_fallback(self):
        manager = object()
        parent = SimpleNamespace(sheets=manager)
        dialog = SimpleNamespace(parentWidget=lambda: parent)

        self.assertIs(app._resolve_item_detail_manager(dialog), manager)

    def test_item_detail_dialog_opens_with_the_supplied_manager(self):
        item = {
            "row": "qa-item",
            "num": 1,
            "name": "QA01",
            "company": "QA",
            "note": "상세창",
            "checklist": "gender:M",
        }
        dialog = app._core.ItemDetailDialog(item, SimpleNamespace(), SimpleNamespace())
        try:
            self.assertEqual(dialog.windowTitle(), "정보 수정")
        finally:
            dialog.close()


if __name__ == "__main__":
    unittest.main()
