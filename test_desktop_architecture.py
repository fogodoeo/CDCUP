import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent


class DesktopArchitectureTests(unittest.TestCase):
    def test_runtime_sources_and_frozen_core_are_reproducible(self):
        required = [
            "band_monitor_app.py",
            "band_monitor_app_core.pyc",
            "auction_contract.py",
            "capture_client.py",
            "label_spool.py",
            "platform_manager.py",
            "supabase_manager.py",
            "requirements.txt",
            "config.example.json",
        ]
        self.assertEqual([name for name in required if not (ROOT / name).is_file()], [])

    def test_example_config_contains_no_operational_secret(self):
        config = json.loads((ROOT / "config.example.json").read_text(encoding="utf-8"))
        for key in ("api_key", "supabase_key", "capture_agent_token", "platform_admin_password", "quiz_answer_secret"):
            self.assertEqual(config.get(key), "")

    def test_monitor_fails_closed_instead_of_falling_back_across_channels(self):
        source = (ROOT / "band_monitor_app.py").read_text(encoding="utf-8")
        self.assertIn("raise RuntimeError(f\"CREO 채널 관리자 초기화 실패", source)
        self.assertNotIn("Channel manager init failed, falling back", source)
        self.assertIn("CaptureClient", source)
        self.assertIn("_sync_auction_animation_config(self.config, self.sheets)", source)

    def test_platform_motion_and_capture_follow_the_verified_channel(self):
        source = (ROOT / "band_monitor_app.py").read_text(encoding="utf-8")
        value_index = source.index('value = "1" if _as_bool(config.get("auction_animation_enabled")')
        platform_index = source.index('if is_channel_aware and getattr(manager, "using_platform", False):')
        self.assertLess(value_index, platform_index)
        self.assertIn('capture_channel = session_channel if configured_channel in {"", "auto"}', source)


if __name__ == "__main__":
    unittest.main()
