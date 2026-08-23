import unittest
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from PIL import Image
from niimprint.packet import NiimbotPacket

import niimbot_printer


def port(device, description="", hwid="", vid=None):
    return SimpleNamespace(
        device=device,
        description=description,
        hwid=hwid,
        vid=vid,
    )


class NiimbotUsbTransportTests(unittest.TestCase):
    def test_printer_telemetry_calculates_rfid_roll_remaining(self):
        printer = SimpleNamespace(
            get_info=lambda key: 4,
            get_rfid=lambda: {"total": 150, "used": 14, "type": 1},
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            status_path = Path(temp_dir) / "printer_telemetry.json"
            with patch.object(niimbot_printer, "PRINTER_TELEMETRY_PATH", status_path):
                status = niimbot_printer._capture_printer_telemetry(
                    printer,
                    "serial",
                    "COM4",
                )
            stored = json.loads(status_path.read_text(encoding="utf-8"))

        self.assertEqual(status["battery_level"], 4)
        self.assertEqual(status["paper_remaining"], 136)
        self.assertEqual(stored["endpoint"], "COM4")
        self.assertGreater(stored["updated_at"], 0)

    def test_telemetry_failure_never_turns_a_completed_print_into_failure(self):
        def fail():
            raise RuntimeError("status unavailable")

        printer = SimpleNamespace(
            get_info=lambda key: fail(),
            get_rfid=fail,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            status_path = Path(temp_dir) / "printer_telemetry.json"
            with patch.object(niimbot_printer, "PRINTER_TELEMETRY_PATH", status_path):
                status = niimbot_printer._capture_printer_telemetry(
                    printer,
                    "serial",
                    "COM4",
                )

        self.assertEqual(status["transport"], "usb")
        self.assertNotIn("paper_remaining", status)

    def test_usb_bitmap_rows_are_batched_without_changing_packet_order(self):
        rows = [(index, bytes((index, index + 1))) for index in range(10)]
        writes = []

        def write(payload):
            writes.append(payload)
            return len(payload)

        printer = SimpleNamespace(
            _transport=SimpleNamespace(write=write),
            _send=MagicMock(),
        )

        with (
            patch.object(niimbot_printer, "_manual_encode_image", return_value=rows),
            patch.object(niimbot_printer.time, "sleep"),
        ):
            count = niimbot_printer._send_manual_image_rows(
                printer,
                SimpleNamespace(height=10),
                serial_batch_size=4,
            )

        expected = b"".join(NiimbotPacket(0x85, payload).to_bytes() for _, payload in rows)
        self.assertEqual(count, 10)
        self.assertEqual(len(writes), 3)
        self.assertEqual(b"".join(writes), expected)
        printer._send.assert_not_called()

    def test_usb_bitmap_partial_write_fails_instead_of_printing_partial_label(self):
        printer = SimpleNamespace(
            _transport=SimpleNamespace(write=lambda payload: len(payload) - 1),
            _send=MagicMock(),
        )

        with (
            patch.object(
                niimbot_printer,
                "_manual_encode_image",
                return_value=[(0, b"\x01")],
            ),
            self.assertRaisesRegex(RuntimeError, "일부만 완료"),
        ):
            niimbot_printer._send_manual_image_rows(
                printer,
                SimpleNamespace(height=1),
            )

    def test_bluetooth_bitmap_path_keeps_individual_packet_pacing(self):
        rows = [(0, b"\x01"), (1, b"\x02")]
        printer = SimpleNamespace(
            _transport=SimpleNamespace(write=MagicMock()),
            _send=MagicMock(),
        )

        with (
            patch.object(niimbot_printer, "_manual_encode_image", return_value=rows),
            patch.object(niimbot_printer.time, "sleep") as sleep,
        ):
            count = niimbot_printer._send_manual_image_rows(
                printer,
                SimpleNamespace(height=2),
                use_fire_and_forget=True,
            )

        self.assertEqual(count, 2)
        self.assertEqual(printer._send.call_count, 2)
        printer._transport.write.assert_not_called()
        self.assertEqual(sleep.call_count, 2)

    def test_serial_command_surfaces_no_paper_immediately(self):
        printer = SimpleNamespace(
            _transceive=lambda *args: SimpleNamespace(type=0xDB, data=b"\x02")
        )

        with self.assertRaisesRegex(RuntimeError, "용지 없음"):
            niimbot_printer._serial_command(
                printer, 0x01, b"\x01", 1, "인쇄 시작"
            )

    def test_native_usb_detection_excludes_bluetooth_virtual_com(self):
        self.assertTrue(
            niimbot_printer._is_niimbot_usb_serial_port(
                port("COM9", hwid=r"USB\VID_3513&PID_0001", vid=0x3513)
            )
        )
        self.assertFalse(
            niimbot_printer._is_niimbot_usb_serial_port(
                port("COM8", hwid=r"BTHENUM\{00001101-0000-1000-8000-00805F9B34FB}")
            )
        )

        self.assertTrue(
            niimbot_printer._is_niimbot_usb_serial_port(
                port("COM4", hwid="USB VID:PID=0483:5743", vid=0x0483)
            )
        )

    @patch("niimbot_printer._probe_niimbot_usb_protocol", return_value=True)
    @patch("serial.tools.list_ports.comports")
    def test_lists_only_native_niimbot_usb_serial_ports(self, comports, probe):
        comports.return_value = [
            port("COM8", "Bluetooth serial", r"BTHENUM\D110"),
            port("COM9", "USB Serial Device", r"USB\VID_3513&PID_0001", 0x3513),
            port("COM10", "Other USB Serial", r"USB\VID_1234&PID_5678", 0x1234),
            SimpleNamespace(
                device="COM4",
                description="USB Serial Device",
                hwid="USB VID:PID=0483:5743",
                vid=0x0483,
                pid=0x5743,
            ),
        ]

        self.assertEqual(
            niimbot_printer.list_niimbot_usb_serial_candidates(), ["COM4", "COM9"]
        )
        probe.assert_called_once_with("COM4")

    @patch("niimbot_printer._probe_niimbot_usb_protocol", return_value=False)
    @patch("serial.tools.list_ports.comports")
    def test_rejects_shared_st_usb_id_when_protocol_probe_fails(self, comports, probe):
        comports.return_value = [
            SimpleNamespace(
                device="COM4",
                description="USB Serial Device",
                hwid="USB VID:PID=0483:5743",
                vid=0x0483,
                pid=0x5743,
            )
        ]

        self.assertEqual(niimbot_printer.list_niimbot_usb_serial_candidates(), [])
        probe.assert_called_once_with("COM4")

    @patch("niimbot_printer.list_serial_candidates", return_value=["COM8"])
    @patch("niimbot_printer.list_paired_niimbot_addresses")
    @patch("niimbot_printer.list_niimbot_usb_serial_candidates", return_value=["COM9"])
    def test_native_usb_is_attempted_before_configured_ble(
        self, usb_candidates, paired_addresses, serial_candidates
    ):
        paired_addresses.return_value = {
            "ble": ["AA:BB:CC:DD:EE:FF"],
            "btclassic": ["11:22:33:44:55:66"],
        }

        with patch.dict(
            niimbot_printer.LAST_SUCCESSFUL_ENDPOINTS,
            {"ble": "", "serial": "", "btclassic": ""},
            clear=True,
        ):
            attempts = niimbot_printer._build_attempts(
                mac_address="AA:BB:CC:DD:EE:FF", ble_scan_timeout=0
            )

        self.assertEqual(attempts[0], ("serial", "COM9"))
        self.assertIn(("ble", "AA:BB:CC:DD:EE:FF"), attempts)
        self.assertIn(("btclassic", "11:22:33:44:55:66"), attempts)

    @patch("niimbot_printer.list_niimbot_usb_serial_candidates")
    def test_explicit_usb_port_never_falls_back_to_bluetooth(self, usb_candidates):
        attempts = niimbot_printer._build_attempts(
            port="COM4",
            mac_address="AA:BB:CC:DD:EE:FF",
            ble_scan_timeout=0,
        )

        self.assertEqual(attempts, [("serial", "COM4")])
        usb_candidates.assert_not_called()

    @patch("niimbot_printer.list_serial_candidates", return_value=[])
    @patch(
        "niimbot_printer.list_paired_niimbot_addresses",
        return_value={"ble": [], "btclassic": ["02:14:51:D2:EE:A9"]},
    )
    @patch("niimbot_printer.list_niimbot_usb_serial_candidates", return_value=[])
    def test_app_preferred_usb_port_adds_paired_bluetooth_fallback(
        self,
        usb_candidates,
        paired,
        serial_candidates,
    ):
        attempts = niimbot_printer._build_attempts(
            port="COM4",
            ble_scan_timeout=0,
            allow_fallback=True,
        )

        self.assertEqual(
            attempts,
            [
                ("serial", "COM4"),
                ("btclassic", "02:14:51:D2:EE:A9"),
            ],
        )

    @patch(
        "niimbot_printer._build_attempts",
        return_value=[
            ("serial", "COM4"),
            ("btclassic", "02:14:51:D2:EE:A9"),
        ],
    )
    def test_connection_failure_on_usb_uses_next_bluetooth_attempt(self, build_attempts):
        import niimprint

        bluetooth_transport = object()
        client = SimpleNamespace(heartbeat=lambda: {"powerlevel": 4})
        with (
            patch.object(niimprint, "SerialTransport", side_effect=OSError("not connected")),
            patch.object(niimprint, "BluetoothTransport", return_value=bluetooth_transport),
            patch.object(niimprint, "PrinterClient", return_value=client),
        ):
            printer, kind, endpoint = niimbot_printer._connect_printer(
                port="COM4",
                ble_scan_timeout=0,
                allow_fallback=True,
            )

        self.assertIs(printer, client)
        self.assertEqual((kind, endpoint), ("btclassic", "02:14:51:D2:EE:A9"))

    @patch("niimbot_printer.time.sleep")
    @patch("niimbot_printer._capture_printer_telemetry", return_value={})
    @patch("niimbot_printer._manual_print_image")
    @patch("niimbot_printer._connect_printer")
    @patch("niimbot_printer._direct_ble_print_image")
    @patch("niimbot_printer._build_attempts")
    @patch("niimbot_printer.create_label")
    def test_print_skips_direct_ble_when_native_usb_is_preferred(
        self,
        create_label,
        build_attempts,
        direct_ble,
        connect_printer,
        manual_print,
        capture_telemetry,
        sleep,
    ):
        create_label.return_value = Image.new("1", (120, 400), 1)
        build_attempts.return_value = [
            ("serial", "COM9"),
            ("ble", "AA:BB:CC:DD:EE:FF"),
        ]
        connect_printer.return_value = (object(), "serial", "COM9")

        ok = niimbot_printer.print_winner_label(
            num="A01",
            item_name="test",
            winner_name="winner",
            sold_price="100000",
            mac_address="AA:BB:CC:DD:EE:FF",
        )

        self.assertTrue(ok)
        direct_ble.assert_not_called()
        manual_print.assert_called_once()
        capture_telemetry.assert_called_once()


if __name__ == "__main__":
    unittest.main()
