"""Isolated label-print subprocess.

Bluetooth printer libraries can occasionally leave the interpreter in a bad
state after a failed connection.  The main UI starts this worker as a separate
process so a stuck or crashed print job cannot poison the auction workflow.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback


def _configure_stdio():
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleCP(65001)
        except Exception:
            pass
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv=None):
    _configure_stdio()
    parser = argparse.ArgumentParser(description="Run one Niimbot label print job.")
    parser.add_argument("--job-json", required=True)
    args = parser.parse_args(argv)

    with open(args.job_json, "r", encoding="utf-8") as f:
        job = json.load(f)

    try:
        from niimbot_printer import print_winner_label

        ok = print_winner_label(
            num=job.get("num", ""),
            item_name=job.get("item_name", ""),
            winner_name=job.get("winner_name", ""),
            sold_price=job.get("sold_price", ""),
            winner_phone=job.get("winner_phone", ""),
            company=job.get("company", ""),
            mac_address=job.get("mac_address") or None,
            port=job.get("port") or None,
            density=int(job.get("density", 3) or 3),
            ble_scan_timeout=float(job.get("ble_scan_timeout", 1.0) or 0),
            allow_fallback=bool(job.get("allow_fallback", True)),
            font_key=job.get("font_key") or None,
            label_layout=job.get("label_layout") or "auction",
        )
        if ok:
            print(json.dumps({"ok": True}, ensure_ascii=False))
            return 0
        print(json.dumps({"ok": False, "error": "print_winner_label returned False"}, ensure_ascii=False))
        return 2
    except Exception as exc:
        traceback.print_exc()
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    raise SystemExit(main())
