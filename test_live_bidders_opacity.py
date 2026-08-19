import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


class LiveBiddersOpacityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.broadcast = (ROOT / "broadcast.html").read_text(encoding="utf-8")
        cls.preview = (ROOT / "preview.html").read_text(encoding="utf-8")

    def test_preview_exposes_and_persists_bidder_opacity(self):
        self.assertIn('id="live-bidders-opacity-input"', self.preview)
        self.assertIn("function previewLiveBiddersOpacity", self.preview)
        self.assertIn("configMap['live_bidders_opacity']", self.preview)
        self.assertIn("cfg.live_bidders_opacity ?? '94'", self.preview)

    def test_broadcast_applies_bidder_opacity_separately(self):
        self.assertIn("map.live_bidders_opacity ?? '94'", self.broadcast)
        self.assertIn("--live-bidders-opacity", self.broadcast)
        self.assertIn("e.data.type === 'liveBiddersOpacity'", self.broadcast)

    def test_second_bidder_stays_readable(self):
        self.assertIn('#live-bidders-overlay .blind-total-row[data-rank="2"]', self.broadcast)
        self.assertIn("--rank-text-opacity: 0.90;", self.broadcast)


if __name__ == "__main__":
    unittest.main()
