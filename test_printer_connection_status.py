import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import band_monitor_app


def port(device, hwid, vid=None, pid=None):
    return SimpleNamespace(device=device, hwid=hwid, vid=vid, pid=pid)


class PrinterConnectionStatusTests(unittest.TestCase):
    def test_recent_cached_battery_and_rfid_roll_status_is_loaded(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            status_path = Path(temp_dir) / "printer_telemetry.json"
            status_path.write_text(
                json.dumps(
                    {
                        "endpoint": "COM4",
                        "battery_level": 4,
                        "battery_max": 4,
                        "paper_total": 150,
                        "paper_used": 14,
                        "paper_remaining": 136,
                        "updated_at": time.time(),
                    }
                ),
                encoding="utf-8",
            )
            with patch.object(band_monitor_app, "PRINTER_TELEMETRY_PATH", str(status_path)):
                status = band_monitor_app._load_cached_printer_telemetry()

        self.assertEqual(status["battery_level"], 4)
        self.assertEqual(status["paper_remaining"], 136)

    def test_stale_cached_consumable_status_is_ignored(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            status_path = Path(temp_dir) / "printer_telemetry.json"
            status_path.write_text(
                json.dumps({"battery_level": 1, "updated_at": time.time() - 100}),
                encoding="utf-8",
            )
            with patch.object(band_monitor_app, "PRINTER_TELEMETRY_PATH", str(status_path)):
                status = band_monitor_app._load_cached_printer_telemetry(max_age_sec=10)

        self.assertEqual(status, {})

    @patch("serial.tools.list_ports.comports")
    def test_usb_power_status_takes_priority_over_bluetooth(self, comports):
        comports.return_value = [
            port("COM8", r"BTHENUM\D110"),
            port("COM4", "USB VID:PID=0483:5743", 0x0483, 0x5743),
        ]

        self.assertEqual(
            band_monitor_app._passive_printer_connection_snapshot(),
            {"transport": "usb", "endpoint": "COM4", "power": True},
        )

    @patch("serial.tools.list_ports.comports")
    def test_bluetooth_status_when_usb_is_absent(self, comports):
        comports.return_value = [port("COM8", r"BTHENUM\D110")]

        self.assertEqual(
            band_monitor_app._passive_printer_connection_snapshot(),
            {"transport": "bluetooth", "endpoint": "COM8", "power": False},
        )

    @patch("serial.tools.list_ports.comports", return_value=[])
    def test_disconnected_status(self, comports):
        self.assertEqual(
            band_monitor_app._passive_printer_connection_snapshot(),
            {"transport": "none", "endpoint": "", "power": False},
        )


if __name__ == "__main__":
    unittest.main()
