import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


class BroadcastCompanyTagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "broadcast.html").read_text(encoding="utf-8")

    def test_company_tag_is_left_of_item_name(self):
        company_index = self.source.index('id="info-company"')
        name_index = self.source.index('id="info-name"')
        self.assertLess(company_index, name_index)
        self.assertIn('class="name-line"', self.source[company_index - 150:name_index])

    def test_company_tag_is_page2_public_only(self):
        self.assertIn("const showCompanyTag = !isHost && showCompanyInline;", self.source)
        self.assertIn("infoCompany.hidden = !showCompanyTag;", self.source)
        self.assertIn("showCompany: visibility === 'public'", self.source)

    def test_legacy_tournament_uses_screen_blind_setting(self):
        self.assertIn("const configuredBlindMode = String(map?.bracket_full_blind", self.source)
        self.assertIn("configuredBlindMode === '0'", self.source)
        self.assertIn("configuredTournamentVisibility", self.source)

    def test_company_tag_has_independent_spacing(self):
        self.assertIn(".top-bar .name-line", self.source)
        self.assertIn("gap: clamp(11px, 1.1vw, 17px);", self.source)
        self.assertIn(".top-bar .company-tag", self.source)


class SharedNametagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.broadcast = (ROOT / "broadcast.html").read_text(encoding="utf-8")
        cls.preview = (ROOT / "preview.html").read_text(encoding="utf-8")
        cls.settings = (ROOT / "settings.html").read_text(encoding="utf-8")

    def test_three_nametags_are_configurable_and_rendered(self):
        self.assertIn('id="cfg-host-name3"', self.settings)
        self.assertIn('id="draggable-nametag3"', self.preview)
        self.assertIn("configMap.nametag3_left", self.preview)
        self.assertIn('id="host-nametag-3"', self.broadcast)
        self.assertIn("for (let i = 1; i <= 3; i++)", self.broadcast)


if __name__ == "__main__":
    unittest.main()
