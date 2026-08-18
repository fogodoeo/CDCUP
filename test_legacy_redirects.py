from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent


class LegacyRedirectTests(unittest.TestCase):
    def test_legacy_production_pages_route_to_the_single_creok_runtime(self):
        pages = [
            "index.html", "broadcast-router.html", "broadcast.html", "cdcup-index.html",
            "preview.html", "print.html", "ranking.html", "settings.html", "shipping.html",
            "shipping-status.html", "summary.html", "tournament-bracket.html",
            "crewart-broadcast.html", "crewart-control.html", "crewart-preview.html",
            "crewart-ranking.html", "crewart-settings.html",
        ]
        tag = 'legacy-creok-redirect.js?v=20260819-canonical-v1'
        missing = [name for name in pages if tag not in (ROOT / name).read_text(encoding="utf-8")]
        self.assertEqual(missing, [])
        self.assertIn('../legacy-creok-redirect.js?v=20260819-canonical-v1', (ROOT / "cdcup/index.html").read_text(encoding="utf-8"))

    def test_redirect_is_host_scoped_and_preserves_route_query_and_hash(self):
        source = (ROOT / "legacy-creok-redirect.js").read_text(encoding="utf-8")
        self.assertIn("cdcup.onrender.com", source)
        self.assertIn("https://creok.onrender.com", source)
        self.assertIn("location.search", source)
        self.assertIn("location.hash", source)
        self.assertIn("location.replace", source)


if __name__ == "__main__":
    unittest.main()
