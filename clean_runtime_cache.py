"""Clean disposable runtime cache without touching login/session data."""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROFILE = ROOT / "chrome_debug_profile"

SAFE_CACHE_TARGETS = [
    PROFILE / "Default" / "Cache",
    PROFILE / "Default" / "Code Cache",
    PROFILE / "Default" / "GPUCache",
    PROFILE / "Default" / "DawnCache",
    PROFILE / "Default" / "Service Worker" / "CacheStorage",
    PROFILE / "Default" / "Service Worker" / "ScriptCache",
    PROFILE / "GrShaderCache",
    PROFILE / "ShaderCache",
    PROFILE / "GraphiteDawnCache",
    PROFILE / "BrowserMetrics",
    PROFILE / "component_crx_cache",
    PROFILE / "extensions_crx_cache",
    PROFILE / "optimization_guide_model_store",
    PROFILE / "WasmTtsEngine",
]


def _human_size(size):
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024


def _path_size(path):
    if not path.exists():
        return 0, 0
    if path.is_file():
        return path.stat().st_size, 1
    total = 0
    count = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
                count += 1
        except OSError:
            pass
    return total, count


def _profile_is_running(profile):
    if sys.platform != "win32":
        return False
    command = (
        "Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | "
        "Select-Object -ExpandProperty CommandLine"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            check=False,
        )
    except Exception:
        return True
    if result.returncode != 0:
        return True
    needle = str(profile).lower()
    return needle in (result.stdout or "").lower()


def _safe_remove(path, dry_run=False):
    root = PROFILE.resolve()
    target = path.resolve()
    if target == root or root not in target.parents:
        raise RuntimeError(f"refusing to remove outside Chrome profile: {target}")
    size, count = _path_size(target)
    if not path.exists():
        return 0, 0
    if not dry_run:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    return size, count


def main():
    parser = argparse.ArgumentParser(description="Clean disposable Chrome runtime caches.")
    parser.add_argument("--dry-run", action="store_true", help="show what would be removed")
    parser.add_argument("--force", action="store_true", help="skip the Chrome running guard")
    args = parser.parse_args()

    print("Band monitor runtime cache cleanup")
    print(f"profile: {PROFILE}")

    if not PROFILE.exists():
        print("No chrome_debug_profile directory exists yet.")
        return 0

    if not args.force and _profile_is_running(PROFILE):
        print("Chrome is using chrome_debug_profile right now.")
        print("Close the Band Chrome window first, then run this again.")
        return 2

    total = 0
    files = 0
    for target in SAFE_CACHE_TARGETS:
        size, count = _safe_remove(target, dry_run=args.dry_run)
        if size or count:
            action = "would remove" if args.dry_run else "removed"
            print(f"{action}: {target.relative_to(ROOT)} ({_human_size(size)}, {count} files)")
        total += size
        files += count

    print(f"Total {'candidate' if args.dry_run else 'cleaned'}: {_human_size(total)}, {files} files")
    print("Preserved: Cookies, Local Storage, IndexedDB, saved login/session data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
