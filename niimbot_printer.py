import argparse
import asyncio
import math
import os
import re
import struct
import sys
import time
import traceback
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from print_paths import LABEL_OUTPUT_DIR, resolve_output_path


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


_configure_stdio()


APP_DIR = Path(__file__).resolve().parent
FONT_DIR = APP_DIR / "fonts"
APPLE_SD_REGULAR_PATH = Path("C:/Windows/Fonts/AppleSDGothicNeoM.ttf")
APPLE_SD_BOLD_PATH = Path("C:/Windows/Fonts/AppleSDGothicNeoB.ttf")
PRETENDARD_REGULAR_PATH = FONT_DIR / "Pretendard-Regular.otf"
PRETENDARD_SEMIBOLD_PATH = FONT_DIR / "Pretendard-SemiBold.otf"
PRETENDARD_BOLD_PATH = FONT_DIR / "Pretendard-Bold.otf"
PRETENDARD_EXTRA_BOLD_PATH = FONT_DIR / "Pretendard-ExtraBold.otf"
PRETENDARD_BLACK_PATH = FONT_DIR / "Pretendard-Black.otf"

DEFAULT_FONT_PATH = str(
    APPLE_SD_REGULAR_PATH
    if APPLE_SD_REGULAR_PATH.exists()
    else PRETENDARD_REGULAR_PATH
    if PRETENDARD_REGULAR_PATH.exists()
    else Path("C:/Windows/Fonts/malgun.ttf")
)
DEFAULT_FONT_SB_PATH = str(
    APPLE_SD_BOLD_PATH
    if APPLE_SD_BOLD_PATH.exists()
    else PRETENDARD_SEMIBOLD_PATH
    if PRETENDARD_SEMIBOLD_PATH.exists()
    else PRETENDARD_BOLD_PATH
    if PRETENDARD_BOLD_PATH.exists()
    else Path("C:/Windows/Fonts/malgunbd.ttf")
)
DEFAULT_FONT_BD_PATH = DEFAULT_FONT_SB_PATH
DEFAULT_FONT_XB_PATH = DEFAULT_FONT_SB_PATH
DEFAULT_FONT_BLACK_PATH = DEFAULT_FONT_SB_PATH
LAST_SUCCESSFUL_ENDPOINTS = {
    "ble": "",
    "serial": "",
    "btclassic": "",
}

# ── 선택 가능 폰트 목록 ──
AVAILABLE_FONTS = {
    "pretendard": {
        "display": "Pretendard (기본)",
        "regular": str(FONT_DIR / "Pretendard-Regular.otf"),
        "bold": str(FONT_DIR / "Pretendard-SemiBold.otf"),
    },
    "noto_sans_kr": {
        "display": "Noto Sans KR",
        "regular": str(FONT_DIR / "NotoSansKR-Regular.ttf"),
        "bold": str(FONT_DIR / "NotoSansKR-Regular.ttf"),
    },
    "nanum_gothic": {
        "display": "나눔고딕",
        "regular": str(FONT_DIR / "NanumGothic-Regular.ttf"),
        "bold": str(FONT_DIR / "NanumGothic-Bold.ttf"),
    },
    "ibm_plex_sans_kr": {
        "display": "IBM Plex Sans KR",
        "regular": str(FONT_DIR / "IBMPlexSansKR-Regular.ttf"),
        "bold": str(FONT_DIR / "IBMPlexSansKR-Bold.ttf"),
    },
    "spoqa_han_sans": {
        "display": "스포카 한 산스 Neo",
        "regular": str(FONT_DIR / "SpoqaHanSansNeo-Regular.otf"),
        "bold": str(FONT_DIR / "SpoqaHanSansNeo-Bold.otf"),
    },
    "gothic_a1": {
        "display": "Gothic A1",
        "regular": str(FONT_DIR / "GothicA1-Regular.ttf"),
        "bold": str(FONT_DIR / "GothicA1-Bold.ttf"),
    },
}


def get_font_paths(font_key=None):
    """폰트 키로 Regular/Bold 경로를 반환합니다. 없으면 기본 폰트."""
    if font_key and font_key in AVAILABLE_FONTS:
        info = AVAILABLE_FONTS[font_key]
        regular = info["regular"]
        bold = info["bold"]
        # 파일이 실제로 있는지 확인
        if Path(regular).exists():
            if not Path(bold).exists():
                bold = regular
            return regular, bold
    # 폴백: 기존 기본 폰트
    return DEFAULT_FONT_SB_PATH, DEFAULT_FONT_SB_PATH


def get_available_font_list():
    """설치된 폰트 목록을 [(key, display_name), ...] 형태로 반환합니다."""
    result = []
    for key, info in AVAILABLE_FONTS.items():
        if Path(info["regular"]).exists():
            result.append((key, info["display"]))
    return result


D110_LABEL_WIDTH_PX = 120
D110_LABEL_HEIGHT_PX = 400
LANDSCAPE_LABEL_WIDTH_PX = 400
LANDSCAPE_LABEL_HEIGHT_PX = 120
D110_NAME_KEYWORDS = ("D110", "D11", "B21", "B18", "NIIM", "NIM")


def _configure_console_encoding():
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


_configure_console_encoding()


def _safe_text(value):
    return "" if value is None else str(value).strip()


def _matches_niimbot_name(name):
    name = _safe_text(name).upper()
    return bool(name) and any(keyword in name for keyword in D110_NAME_KEYWORDS)


def _remember_successful_endpoint(kind, endpoint):
    endpoint = _safe_text(endpoint)
    if kind in LAST_SUCCESSFUL_ENDPOINTS and endpoint:
        LAST_SUCCESSFUL_ENDPOINTS[kind] = endpoint


def _load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def _fit_text(draw, text, font, max_width):
    text = _safe_text(text)
    if not text:
        return ""
    if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
        return text

    ellipsis = "..."
    for length in range(len(text), 0, -1):
        candidate = text[:length].rstrip() + ellipsis
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            return candidate
    return ellipsis


def _format_phone(phone):
    digits = "".join(ch for ch in _safe_text(phone) if ch.isdigit())
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return _safe_text(phone)


def _format_price_text(price):
    text = _safe_text(price)
    if not text:
        return "-"
    compact = text.replace(",", "").replace(" ", "")
    if any(token in compact for token in ("만", "원")):
        return text
    try:
        number = float(compact)
    except ValueError:
        return text
    if number.is_integer():
        return f"{int(number)}만"
    return f"{number:g}만"


def _format_price_number(price):
    text = _safe_text(price)
    if not text:
        return "-"
    compact = text.replace(",", "").replace(" ", "").replace("만", "").replace("원", "")
    try:
        number = float(compact)
    except ValueError:
        return text
    if number.is_integer():
        return str(int(number))
    return f"{number:g}"


def _format_price_badge(price):
    text = _safe_text(price)
    if not text:
        return "-"
    compact = text.replace(",", "").replace(" ", "").replace("만", "").replace("원", "")
    try:
        number = float(compact)
    except ValueError:
        return text
    return f"{number:.1f}"


def _format_price_number(price):
    text = _safe_text(price)
    if not text:
        return "-"
    compact = (
        text.replace(",", "")
        .replace(" ", "")
        .replace("만원", "")
        .replace("만", "")
        .replace("원", "")
        .replace("留?", "")
        .replace("??", "")
    )
    try:
        number = float(compact)
    except ValueError:
        return text
    if number >= 1000:
        number = number / 10000
    if number.is_integer():
        return str(int(number))
    return f"{number:g}"


def _format_price_number(price):
    text = _safe_text(price)
    if not text:
        return "-"
    compact = (
        text.replace(",", "")
        .replace(" ", "")
        .replace("\ub9cc\uc6d0", "")
        .replace("\ub9cc", "")
        .replace("\uc6d0", "")
        .replace("留뚯썝", "")
        .replace("留?", "")
        .replace("??", "")
        .replace("筌?", "")
    )
    try:
        number = float(compact)
    except ValueError:
        return text
    if number >= 1000:
        number = number / 10000
    if number.is_integer():
        return str(int(number))
    return f"{number:g}"


def _measure_text(draw, text, font):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top


def _draw_text_in_box(draw, text, font, box, fill=0, align="left", valign="center", padding_x=0):
    text = _safe_text(text)
    if not text:
        return
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_width = right - left
    text_height = bottom - top
    x0, y0, x1, y1 = box

    if align == "right":
        x = x1 - padding_x - text_width - left
    elif align == "center":
        x = x0 + ((x1 - x0) - text_width) / 2 - left
    else:
        x = x0 + padding_x - left

    if valign == "top":
        y = y0 - top
    elif valign == "bottom":
        y = y1 - text_height - top
    else:
        y = y0 + ((y1 - y0) - text_height) / 2 - top

    draw.text((int(round(x)), int(round(y))), text, font=font, fill=fill)


def _prepare_image_for_print(image):
    return image.convert("L")


def _fit_font_to_box(draw, text, font_path, max_width, max_height, max_size, min_size=10):
    text = _safe_text(text) or "-"
    for size in range(max_size, min_size - 1, -1):
        font = _load_font(font_path, size)
        text_width, text_height = _measure_text(draw, text, font)
        if text_width <= max_width and text_height <= max_height:
            return font
    return _load_font(font_path, min_size)


def _fit_common_font_to_box(draw, texts, font_path, max_width, max_height, max_size, min_size=10):
    texts = [_safe_text(text) or "-" for text in texts]
    for size in range(max_size, min_size - 1, -1):
        font = _load_font(font_path, size)
        fits = True
        for text in texts:
            text_width, text_height = _measure_text(draw, text, font)
            if text_width > max_width or text_height > max_height:
                fits = False
                break
        if fits:
            return font
    return _load_font(font_path, min_size)


def _first_label_char(text):
    text = _safe_text(text)
    for char in text:
        if char.isspace():
            continue
        if char in "-_/[](){}":
            continue
        return char
    return text[:1] if text else "-"


def _item_prefix(text, limit=4):
    chars = []
    for char in _safe_text(text):
        if char.isspace():
            continue
        if char in "-_/[](){}":
            continue
        chars.append(char)
        if len(chars) >= limit:
            break
    return "".join(chars)


def _meaningful_item_chars(text):
    chars = []
    for char in _safe_text(text):
        if char.isspace():
            continue
        if char in "-_/[](){}":
            continue
        chars.append(char)
    return chars


def _company_block_text(company, limit=4):
    return _item_prefix(company, limit=limit) or "-"


def _company_block_lines(company, limit=4):
    company_block = _company_block_text(company, limit=limit)
    return [company_block]


def _fit_multiline_font_to_box(draw, lines, font_path, max_width, max_height, max_size, min_size=10, line_gap=0):
    prepared_lines = [_safe_text(line) or "-" for line in lines if _safe_text(line)]
    if not prepared_lines:
        prepared_lines = ["-"]
    for size in range(max_size, min_size - 1, -1):
        font = _load_font(font_path, size)
        widths = []
        heights = []
        for line in prepared_lines:
            text_width, text_height = _measure_text(draw, line, font)
            widths.append(text_width)
            heights.append(text_height)
        total_height = sum(heights) + line_gap * (len(prepared_lines) - 1)
        if max(widths) <= max_width and total_height <= max_height:
            return font
    return _load_font(font_path, min_size)


def _draw_multiline_text_in_box(draw, lines, font, box, fill=0, align="center", line_gap=0):
    prepared_lines = [_safe_text(line) for line in lines if _safe_text(line)]
    if not prepared_lines:
        return

    metrics = []
    total_height = 0
    for line in prepared_lines:
        left, top, right, bottom = draw.textbbox((0, 0), line, font=font)
        text_width = right - left
        text_height = bottom - top
        metrics.append((line, left, top, text_width, text_height))
        total_height += text_height
    total_height += line_gap * (len(prepared_lines) - 1)

    x0, y0, x1, y1 = box
    current_y = y0 + ((y1 - y0) - total_height) / 2
    for line, left, top, text_width, text_height in metrics:
        if align == "right":
            x = x1 - text_width - left
        elif align == "left":
            x = x0 - left
        else:
            x = x0 + ((x1 - x0) - text_width) / 2 - left
        y = current_y - top
        draw.text((int(round(x)), int(round(y))), line, font=font, fill=fill)
        current_y += text_height + line_gap


def _wrap_text_to_width(draw, text, font, max_width, max_lines=2):
    text = _safe_text(text)
    if not text:
        return []
    if _measure_text(draw, text, font)[0] <= max_width:
        return [text]

    lines = []
    current = ""
    for char in text:
        candidate = current + char
        if current and _measure_text(draw, candidate, font)[0] > max_width:
            lines.append(current.rstrip())
            current = char.lstrip()
            if len(lines) >= max_lines:
                return None
        else:
            current = candidate
    if current:
        lines.append(current.rstrip())
    if len(lines) > max_lines:
        return None
    if any(_measure_text(draw, line, font)[0] > max_width for line in lines):
        return None
    return lines


def _fit_wrapped_lines_to_box(draw, text, font_path, max_width, max_height, max_size, min_size=8, max_lines=2, line_gap=0):
    text = _safe_text(text) or "-"
    for size in range(max_size, min_size - 1, -1):
        font = _load_font(font_path, size)
        lines = _wrap_text_to_width(draw, text, font, max_width, max_lines=max_lines)
        if not lines:
            continue
        heights = [_measure_text(draw, line, font)[1] for line in lines]
        total_height = sum(heights) + line_gap * (len(lines) - 1)
        if total_height <= max_height:
            return font, lines
    font = _load_font(font_path, min_size)
    return font, [_fit_text(draw, text, font, max_width)]


def _split_item_label(text):
    chars = _meaningful_item_chars(text)
    if not chars:
        return "-", ""
    first = chars[0]
    rest = "".join(chars[1:]).strip()
    return first, rest


def _split_item_code_and_name(text):
    """Split a leading auction code (for example, A1, A, or 1)."""
    raw = _safe_text(text).strip()
    if not raw:
        return "-", ""

    code_match = re.match(r"^([A-Za-z](?:\d+)?|\d+)\s+(.+)$", raw)
    if code_match:
        return code_match.group(1).upper(), code_match.group(2).strip()

    return "-", raw


def _compact_phone(phone):
    digits = "".join(ch for ch in _safe_text(phone) if ch.isdigit())
    return digits or _safe_text(phone)


def _format_phone_tail(phone):
    digits = _compact_phone(phone)
    if len(digits) >= 8 and digits.isdigit():
        tail = digits[-8:]
        return f"{tail[:4]}.{tail[4:]}"
    return digits


def _display_winner_name(text):
    parts = [part for part in _safe_text(text).replace("/", " ").split() if part]
    if not parts:
        return ""
    return " ".join(parts)


def _build_primary_line(num, company, item_name, sold_price=None):
    _, item_rest = _split_item_label(item_name)
    return item_rest


def _build_secondary_line(winner_name, winner_phone):
    return _display_winner_name(winner_name)


def _build_tertiary_line(winner_phone):
    phone = _safe_text(winner_phone)
    if not phone:
        return ""
    return _format_phone(phone)


def _build_item_identity(company, item_name):
    company_text = _safe_text(company)
    item_text = _safe_text(item_name)
    if company_text and item_text:
        if company_text in item_text:
            return item_text
        return f"{company_text} {item_text}"
    return item_text or company_text or "-"


def _build_two_line_auction_title(company, item_name, winner_name, sold_price):
    identity = _build_item_identity(company, item_name)
    buyer = _display_winner_name(winner_name)
    price_number = _format_price_number(sold_price)
    price_text = f"{price_number}\ub9cc" if price_number and price_number != "-" else ""
    parts = [part for part in (identity, buyer, price_text) if _safe_text(part)]
    return "  ".join(parts) or "-"


def _create_landscape_label_legacy(num, item_name, winner_name, sold_price, winner_phone="", company="", font_key=None):
    width = LANDSCAPE_LABEL_WIDTH_PX
    height = LANDSCAPE_LABEL_HEIGHT_PX

    font_regular_path, font_bold_path = get_font_paths(font_key)

    img = Image.new("1", (width, height), 255)
    draw = ImageDraw.Draw(img)

    item_text = _safe_text(item_name) or "-"
    winner_text = _build_secondary_line(winner_name, winner_phone) or "-"
    phone_text = _build_tertiary_line(winner_phone) or "-"
    company_text = _safe_text(company) or "AUCTION"
    num_text = f"#{_safe_text(num)}" if _safe_text(num) else "NO"
    price_number = _format_price_number(sold_price)
    price_text = f"{price_number}만" if price_number and price_number != "-" else "-"

    safe_x0 = 20
    safe_x1 = width - 20
    safe_y0 = 6
    safe_y1 = height - 12
    left_x1 = safe_x0 + 68
    right_x0 = left_x1 + 10
    price_x0 = safe_x1 - 108

    num_box = (safe_x0, safe_y0 + 4, left_x1 - 6, safe_y0 + 48)
    company_box = (safe_x0, safe_y0 + 52, left_x1 - 6, safe_y1 - 4)
    item_box = (right_x0, safe_y0 + 4, price_x0 - 8, safe_y0 + 37)
    price_box = (price_x0, safe_y0 + 4, safe_x1, safe_y0 + 37)
    winner_box = (right_x0, safe_y0 + 43, safe_x1, safe_y0 + 72)
    phone_box = (right_x0, safe_y0 + 76, safe_x1, safe_y1 - 4)

    num_font = _fit_font_to_box(
        draw, num_text, font_bold_path,
        max_width=(num_box[2] - num_box[0]) - 2,
        max_height=(num_box[3] - num_box[1]) - 2,
        max_size=28,
        min_size=12,
    )
    company_font = _fit_font_to_box(
        draw, company_text, font_bold_path,
        max_width=(company_box[2] - company_box[0]) - 2,
        max_height=(company_box[3] - company_box[1]) - 2,
        max_size=16,
        min_size=8,
    )
    item_font = _fit_font_to_box(
        draw, item_text, font_bold_path,
        max_width=(item_box[2] - item_box[0]) - 2,
        max_height=(item_box[3] - item_box[1]) - 2,
        max_size=23,
        min_size=10,
    )
    price_font = _fit_font_to_box(
        draw, price_text, font_bold_path,
        max_width=(price_box[2] - price_box[0]) - 2,
        max_height=(price_box[3] - price_box[1]) - 2,
        max_size=26,
        min_size=12,
    )
    winner_font = _fit_font_to_box(
        draw, winner_text, font_bold_path,
        max_width=(winner_box[2] - winner_box[0]) - 4,
        max_height=(winner_box[3] - winner_box[1]) - 2,
        max_size=24,
        min_size=12,
    )
    phone_font = _fit_font_to_box(
        draw, phone_text, font_bold_path,
        max_width=(phone_box[2] - phone_box[0]) - 4,
        max_height=(phone_box[3] - phone_box[1]) - 2,
        max_size=20,
        min_size=10,
    )

    item_text = _fit_text(draw, item_text, item_font, (item_box[2] - item_box[0]) - 2)
    company_text = _fit_text(draw, company_text, company_font, (company_box[2] - company_box[0]) - 2)
    winner_text = _fit_text(draw, winner_text, winner_font, (winner_box[2] - winner_box[0]) - 4)
    phone_text = _fit_text(draw, phone_text, phone_font, (phone_box[2] - phone_box[0]) - 4)

    draw.rectangle((safe_x0, safe_y0, safe_x1, safe_y1), outline=0, width=2)
    draw.line([(left_x1, safe_y0 + 4), (left_x1, safe_y1 - 4)], fill=0, width=2)
    draw.line([(right_x0, safe_y0 + 40), (safe_x1, safe_y0 + 40)], fill=0, width=1)
    draw.line([(right_x0, safe_y0 + 74), (safe_x1, safe_y0 + 74)], fill=0, width=1)
    draw.line([(price_x0 - 4, safe_y0 + 8), (price_x0 - 4, safe_y0 + 34)], fill=0, width=1)

    _draw_text_in_box(draw, num_text, num_font, num_box, fill=0, align="center")
    _draw_text_in_box(draw, company_text, company_font, company_box, fill=0, align="center")
    _draw_text_in_box(draw, item_text, item_font, item_box, fill=0, align="left", padding_x=0)
    _draw_text_in_box(draw, price_text, price_font, price_box, fill=0, align="right", padding_x=0)
    _draw_text_in_box(draw, winner_text, winner_font, winner_box, fill=0, align="center")
    _draw_text_in_box(draw, phone_text, phone_font, phone_box, fill=0, align="center")

    return img


def _create_landscape_label(num, item_name, winner_name, sold_price, winner_phone="", company="", font_key=None):
    width = LANDSCAPE_LABEL_WIDTH_PX
    height = LANDSCAPE_LABEL_HEIGHT_PX

    _font_regular_path, font_bold_path = get_font_paths(font_key)
    use_pretendard = not _safe_text(font_key) or _safe_text(font_key).lower() == "pretendard"
    font_heavy_path = str(PRETENDARD_BLACK_PATH) if use_pretendard and PRETENDARD_BLACK_PATH.exists() else font_bold_path
    img = Image.new("1", (width, height), 255)
    draw = ImageDraw.Draw(img)

    # `num` is only the row/order number in the monitor, so it must never be
    # printed as the animal identity.  Use the code embedded at the beginning
    # of the item name instead: "A1 아잔틱" -> "A1", "A 아잔틱" -> "A",
    # "1 아잔틱1" -> "1".
    raw_name = _safe_text(item_name).strip()
    slot_code, _item_rest = _split_item_code_and_name(raw_name)
    if slot_code != "-":
        item_mark = slot_code
    else:
        numeric_code_match = re.match(r"^(\d+)\s+", raw_name)
        if numeric_code_match:
            item_mark = numeric_code_match.group(1)
        else:
            item_mark = raw_name
            # A trailing price belongs in the dedicated price box, not in the
            # narrow black identity panel (for example, "아잔틱 8만원").
            item_mark = re.sub(r"\s+\d+(?:\.\d+)?\s*만원\s*$", "", item_mark).strip() or "-"
    item_mark = item_mark.replace("#", "")

    # 업체명 앞 4글자 제한
    company_text = _safe_text(company) or "-"
    if len(company_text) > 4:
        company_text = company_text[:4]

    # 낙찰자 이름/지역 7글자 제한 (뒤는 자름)
    buyer_text = _display_winner_name(winner_name) or "-"
    if len(buyer_text) > 7:
        buyer_text = buyer_text[:7] + ".."

    price_number = _format_price_number(sold_price)
    try:
        price_float = float(price_number)
        price_text = f"{price_float:.1f}"
    except (ValueError, TypeError):
        price_text = price_number

    phone_text = _build_tertiary_line(winner_phone) or "-"

    # Y축 위로 시프트
    safe_x0 = 12
    safe_x1 = width - 12
    safe_y0 = 2
    safe_y1 = height - 14
    panel_x1 = safe_x0 + 90
    right_x0 = panel_x1 + 12

    # 박스 영역 설정 (업체명 영역 좌우 패딩 줄임, 높이 약간 위로 조절)
    company_box = (safe_x0 + 2, safe_y0 + 3, panel_x1 - 2, safe_y0 + 44)
    mark_box = (safe_x0 + 4, safe_y0 + 46, panel_x1 - 4, safe_y1 - 4)

    # 이름/지역 박스 & 금액 박스
    row1_left_box = (right_x0, safe_y0 + 4, safe_x1 - 100, safe_y0 + 42)
    row1_right_box = (safe_x1 - 95, safe_y0 + 4, safe_x1, safe_y0 + 42)

    # 전화번호 박스 (Y: safe_y0 + 49 ~ safe_y1 - 5 로 높여 하단 짤림 완벽 차단)
    row2_box = (right_x0, safe_y0 + 49, safe_x1, safe_y1 - 5)

    company_font = _fit_font_to_box(
        draw, company_text, font_bold_path,
        max_width=(company_box[2] - company_box[0]) - 1,
        max_height=(company_box[3] - company_box[1]) - 1,
        max_size=32,  # 26 -> 32로 상향하여 한 폰트 더 키움!
        min_size=8,
    )
    mark_font, mark_lines = _fit_wrapped_lines_to_box(
        draw, item_mark, font_heavy_path,
        max_width=(mark_box[2] - mark_box[0]) - 1,
        max_height=(mark_box[3] - mark_box[1]) - 1,
        max_size=34,
        min_size=12,
        max_lines=2,
        line_gap=0,
    )
    buyer_font = _fit_font_to_box(
        draw, buyer_text, font_heavy_path,
        max_width=(row1_left_box[2] - row1_left_box[0]) - 2,
        max_height=(row1_left_box[3] - row1_left_box[1]) - 1,
        max_size=28,
        min_size=12,
    )
    price_font = _fit_font_to_box(
        draw, price_text, font_heavy_path,
        max_width=(row1_right_box[2] - row1_right_box[0]) - 2,
        max_height=(row1_right_box[3] - row1_right_box[1]) - 1,
        max_size=28,
        min_size=12,
    )
    phone_font = _fit_font_to_box(
        draw, phone_text, font_heavy_path,
        max_width=(row2_box[2] - row2_box[0]) - 2,
        max_height=(row2_box[3] - row2_box[1]) - 1,
        max_size=28,
        min_size=12,
    )

    company_text = _fit_text(draw, company_text, company_font, (company_box[2] - company_box[0]) - 1)
    buyer_text = _fit_text(draw, buyer_text, buyer_font, (row1_left_box[2] - row1_left_box[0]) - 2)
    price_text = _fit_text(draw, price_text, price_font, (row1_right_box[2] - row1_right_box[0]) - 2)
    phone_text = _fit_text(draw, phone_text, phone_font, (row2_box[2] - row2_box[0]) - 2)

    # 흑백 반전 없이 내부 라인들만 그리기 (메인 테두리 사각형 제거, 중앙 세로선 제거)
    draw.line([(safe_x0, safe_y0 + 45), (panel_x1, safe_y0 + 45)], fill=0, width=1)

    # 오른쪽 패널 가로 구분선 (Y: safe_y0 + 45)
    draw.line([(right_x0, safe_y0 + 45), (safe_x1, safe_y0 + 45)], fill=0, width=1)

    # 첫째 줄 좌우 섹션 수직 구분선
    draw.line([(safe_x1 - 98, safe_y0 + 8), (safe_x1 - 98, safe_y0 + 38)], fill=0, width=1)

    # 개체코드(왼쪽 두번째 줄) 영역에 검은색 배경 채우기
    draw.rectangle((safe_x0, safe_y0 + 46, panel_x1 - 1, safe_y1), fill=0)

    _draw_text_in_box(draw, company_text, company_font, company_box, fill=0, align="center")
    _draw_multiline_text_in_box(draw, mark_lines, mark_font, mark_box, fill=255, align="center", line_gap=0)
    _draw_text_in_box(draw, buyer_text, buyer_font, row1_left_box, fill=0, align="left", padding_x=2)
    _draw_text_in_box(draw, price_text, price_font, row1_right_box, fill=0, align="center")
    _draw_text_in_box(draw, phone_text, phone_font, row2_box, fill=0, align="center")

    return img


def create_auction_label(num, item_name, winner_name, sold_price, winner_phone="", company="", font_key=None):
    landscape = _create_landscape_label(
        num=num,
        item_name=item_name,
        winner_name=winner_name,
        sold_price=sold_price,
        winner_phone=winner_phone,
        company=company,
        font_key=font_key,
    )
    return landscape.rotate(90, expand=True)


def _create_contact_landscape_label(num, item_name, winner_name, sold_price, winner_phone="", company="", font_key=None):
    width = LANDSCAPE_LABEL_WIDTH_PX
    height = LANDSCAPE_LABEL_HEIGHT_PX
    font_regular_path, font_bold_path = get_font_paths(font_key)

    img = Image.new("1", (width, height), 255)
    draw = ImageDraw.Draw(img)

    item_text = _safe_text(item_name) or "-"
    buyer_text = _display_winner_name(winner_name) or "-"
    phone_text = _build_tertiary_line(winner_phone) or "-"

    safe_x0 = 20
    safe_x1 = width - 20
    safe_y0 = 6
    safe_y1 = height - 12
    item_box = (safe_x0, safe_y0 + 4, safe_x1, safe_y0 + 40)
    buyer_box = (safe_x0, safe_y0 + 46, safe_x1, safe_y0 + 72)
    phone_box = (safe_x0, safe_y0 + 76, safe_x1, safe_y1 - 4)

    item_font, item_lines = _fit_wrapped_lines_to_box(
        draw,
        item_text,
        font_bold_path,
        max_width=(item_box[2] - item_box[0]) - 2,
        max_height=(item_box[3] - item_box[1]) - 2,
        max_size=24,
        min_size=8,
        max_lines=2,
        line_gap=0,
    )
    buyer_font = _fit_font_to_box(
        draw,
        buyer_text,
        font_bold_path,
        max_width=(buyer_box[2] - buyer_box[0]) - 2,
        max_height=(buyer_box[3] - buyer_box[1]) - 2,
        max_size=23,
        min_size=10,
    )
    phone_font = _fit_font_to_box(
        draw,
        phone_text,
        font_bold_path,
        max_width=(phone_box[2] - phone_box[0]) - 2,
        max_height=(phone_box[3] - phone_box[1]) - 2,
        max_size=20,
        min_size=12,
    )

    buyer_text = _fit_text(draw, buyer_text, buyer_font, (buyer_box[2] - buyer_box[0]) - 2)
    phone_text = _fit_text(draw, phone_text, phone_font, (phone_box[2] - phone_box[0]) - 2)

    draw.rectangle((safe_x0, safe_y0, safe_x1, safe_y1), outline=0, width=2)
    draw.line([(safe_x0, safe_y0 + 43), (safe_x1, safe_y0 + 43)], fill=0, width=1)
    draw.line([(safe_x0, safe_y0 + 74), (safe_x1, safe_y0 + 74)], fill=0, width=1)
    _draw_multiline_text_in_box(draw, item_lines, item_font, item_box, fill=0, align="center", line_gap=0)
    _draw_text_in_box(draw, buyer_text, buyer_font, buyer_box, fill=0, align="center")
    _draw_text_in_box(draw, phone_text, phone_font, phone_box, fill=0, align="center")

    return img


def create_contact_label(num, item_name, winner_name, sold_price, winner_phone="", company="", font_key=None):
    landscape = _create_contact_landscape_label(
        num=num,
        item_name=item_name,
        winner_name=winner_name,
        sold_price=sold_price,
        winner_phone=winner_phone,
        company=company,
        font_key=font_key,
    )
    return landscape.rotate(90, expand=True)


def create_label(num, item_name, winner_name, sold_price, winner_phone="", company="", font_key=None, label_layout="auction"):
    if _safe_text(label_layout).lower() in {"contact", "simple", "buyer"}:
        return create_contact_label(
            num=num,
            item_name=item_name,
            winner_name=winner_name,
            sold_price=sold_price,
            winner_phone=winner_phone,
            company=company,
            font_key=font_key,
        )
    return create_auction_label(
        num=num,
        item_name=item_name,
        winner_name=winner_name,
        sold_price=sold_price,
        winner_phone=winner_phone,
        company=company,
        font_key=font_key,
    )


def _manual_encode_image(image):
    dither_none = getattr(getattr(Image, "Dither", Image), "NONE", 0)
    prepared = _prepare_image_for_print(image)
    img = ImageOps.invert(prepared).convert("1", dither=dither_none)
    for y in range(img.height):
        bits = "".join("0" if img.getpixel((x, y)) == 0 else "1" for x in range(img.width))
        row_bytes = int(bits, 2).to_bytes(math.ceil(img.width / 8), "big")
        header = struct.pack(">H3BB", y, 0, 0, 0, 1)
        yield y, header + row_bytes


def _build_packet(command, data=b""):
    checksum = command ^ len(data)
    for value in data:
        checksum ^= value
    return b"\x55\x55" + bytes((command, len(data))) + data + bytes((checksum,)) + b"\xaa\xaa"


def _set_label_type_raw(printer, label_type):
    if label_type in (1, 2, 3):
        return printer.set_label_type(label_type)
    packet = printer._transceive(35, bytes((label_type,)), 16)
    return bool(packet and packet.data and packet.data[0])


def _fire_and_forget_setup(printer, image, density, label_type):
    from niimprint.packet import NiimbotPacket

    setup_packets = [
        NiimbotPacket(193, b"\x01"),
        NiimbotPacket(0x21, bytes((density,))),
        NiimbotPacket(0x23, bytes((label_type,))),
        NiimbotPacket(0x01, b"\x01"),
        NiimbotPacket(0x20, b"\x01"),
        NiimbotPacket(0x03, b"\x01"),
        NiimbotPacket(0x13, struct.pack(">HH", image.height, image.width)),
        NiimbotPacket(0x15, struct.pack(">H", 1)),
    ]
    for packet in setup_packets:
        printer._send(packet)
        time.sleep(0.1)


def _finish_print_fire_and_forget(printer):
    from niimprint.packet import NiimbotPacket

    printer._send(NiimbotPacket(0xE3, b"\x01"))
    time.sleep(2.0)
    printer._send(NiimbotPacket(0xF3, b"\x01"))


async def _direct_ble_print_image(mac_address, image, density=2):
    from bleak import BleakClient

    char_uuid = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"
    density = max(1, min(int(density), 3))
    notifications = []

    async def write_packet(client, command, data=b""):
        raw = _build_packet(command, data)
        for index in range(0, len(raw), 20):
            await client.write_gatt_char(char_uuid, raw[index : index + 20], response=False)
            await asyncio.sleep(0.008)

    async def collect(wait_ms=450):
        await asyncio.sleep(wait_ms / 1000)
        packets = notifications[:]
        notifications.clear()
        return packets

    async def send_expect(client, name, command, data=b"", wait_ms=450):
        await write_packet(client, command, data)
        packets = await collect(wait_ms)
        print(f"[Niimbot] BLE {name}: {[packet.hex() for packet in packets]}")
        return packets

    def on_notify(sender, data):
        notifications.append(bytes(data))

    print(f"[Niimbot] direct BLE 인쇄 시작: {mac_address}")
    async with BleakClient(mac_address, timeout=15.0) as client:
        if not client.is_connected:
            raise RuntimeError("BLE 프린터 연결 실패")

        await client.start_notify(char_uuid, on_notify)
        await asyncio.sleep(0.2)

        await send_expect(client, "density", 0x21, bytes((density,)))
        await send_expect(client, "label_type", 0x23, b"\x01")
        await send_expect(client, "start_print", 0x01, b"\x01")
        await send_expect(client, "clear", 0x20, b"\x01")
        await send_expect(client, "start_page", 0x03, b"\x01")
        await send_expect(client, "dimension", 0x13, struct.pack(">HH", image.height, image.width))
        await send_expect(client, "quantity", 0x15, struct.pack(">H", 1))

        row_count = 0
        for y, payload in _manual_encode_image(image):
            await write_packet(client, 0x85, payload)
            row_count += 1
            if y % 40 == 0:
                print(f"[Niimbot] BLE 비트맵 전송 중... row {y}/{image.height}")

        await asyncio.sleep(0.3)
        await send_expect(client, "end_page", 0xE3, b"\x01")

        page_complete = False
        for attempt in range(16):
            packets = await send_expect(client, f"status{attempt + 1}", 0xA3, b"\x01", wait_ms=180)
            for packet in packets:
                if len(packet) >= 11 and packet[2] == 0xB3:
                    data_len = packet[3]
                    data = packet[4 : 4 + data_len]
                    if len(data) >= 4:
                        page = int.from_bytes(data[:2], "big")
                        print(f"[Niimbot] BLE status page={page} raw={data.hex()}")
                        if page >= 1:
                            page_complete = True
                            break
            if page_complete:
                break

        await send_expect(client, "end_print", 0xF3, b"\x01")
        await asyncio.sleep(2.0)
        await client.stop_notify(char_uuid)

    if not page_complete:
        raise RuntimeError("BLE 인쇄 완료 상태(page=1)를 확인하지 못했습니다.")

    print(f"[Niimbot] direct BLE row 전송 완료: {row_count}")
    return True


def _manual_print_image(printer, image, density=3, read_rfid=False):
    from niimprint.packet import NiimbotPacket

    density = max(1, min(int(density), 3))
    label_type = 1
    transport_name = type(getattr(printer, "_transport", object())).__name__.lower()
    use_fire_and_forget = "bletransport" in transport_name

    if read_rfid:
        try:
            rfid = printer.get_rfid()
        except Exception as exc:
            print(f"[Niimbot] RFID 조회 실패: {exc}")
            rfid = None

        if rfid:
            label_type = int(rfid.get("type") or 1)
            remaining = int(rfid.get("total_len", 0)) - int(rfid.get("used_len", 0))
            print(
                "[Niimbot] RFID 라벨 정보: "
                f"barcode={rfid.get('barcode')} type={label_type} remaining={remaining}"
            )
        else:
            print("[Niimbot] RFID 라벨 정보가 없어 기본 라벨 타입 1로 진행합니다.")
    else:
        print("[Niimbot] RFID 조회를 건너뛰고 기본 라벨 타입 1로 진행합니다.")

    print(f"[Niimbot] 수동 인쇄 시퀀스 시작: density={density}, label_type={label_type}")
    print(f"[Niimbot] 페이지 크기 설정: rows={image.height}, cols={image.width}")

    if use_fire_and_forget:
        print("[Niimbot] BLE raw 전송 모드로 인쇄를 진행합니다.")
        _fire_and_forget_setup(printer, image, density, label_type)
    else:
        if not printer.set_label_density(density):
            raise RuntimeError("라벨 농도 설정 실패")
        if not _set_label_type_raw(printer, label_type):
            raise RuntimeError(f"라벨 타입 설정 실패: {label_type}")
        if not printer.start_print():
            raise RuntimeError("START_PRINT 실패")
        if not printer.allow_print_clear():
            raise RuntimeError("ALLOW_PRINT_CLEAR 실패")
        if not printer.start_page_print():
            raise RuntimeError("START_PAGE_PRINT 실패")
        if not printer.set_dimension(image.height, image.width):
            raise RuntimeError("SET_DIMENSION 실패")
        if not printer.set_quantity(1):
            raise RuntimeError("SET_QUANTITY 실패")

    row_count = 0
    for y, payload in _manual_encode_image(image):
        printer._send(NiimbotPacket(0x85, payload))
        row_count += 1
        if y % 40 == 0:
            print(f"[Niimbot] 비트맵 전송 중... row {y}/{image.height}")
        time.sleep(0.005)

    if use_fire_and_forget:
        _finish_print_fire_and_forget(printer)
        print(f"[Niimbot] 총 {row_count}개 row 전송 완료 (BLE raw)")
        return True

    if not printer.end_page_print():
        print("[Niimbot] END_PAGE_PRINT 응답이 비정상적이지만 상태 폴링을 계속합니다.")

    page_complete = False
    last_status = None
    for attempt in range(60):
        last_status = printer.get_print_status()
        print(f"[Niimbot] 상태 확인 {attempt + 1}/60: {last_status}")
        if last_status.get("page", 0) >= 1:
            page_complete = True
            break
        time.sleep(0.2)

    if not printer.end_print():
        print("[Niimbot] END_PRINT 응답이 비정상적이지만 세션 종료는 시도되었습니다.")

    if not page_complete:
        raise RuntimeError(f"인쇄 완료 상태를 확인하지 못했습니다: {last_status}")

    print(f"[Niimbot] 총 {row_count}개 row 전송 완료, page=1 확인")
    return True


def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError as exc:
        if "asyncio.run() cannot be called from a running event loop" not in str(exc):
            raise
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


async def discover_niimbot_ble_devices(timeout=5.0):
    try:
        from bleak import BleakScanner
    except ImportError:
        print("[Niimbot] bleak 모듈을 찾을 수 없습니다. (pip install bleak)")
        return []

    print(f"[Niimbot] BLE 장치 자동 검색 중... ({timeout:.1f}초)")
    devices = await BleakScanner.discover(timeout=timeout)
    matches = []
    for device in devices:
        name = _safe_text(getattr(device, "name", ""))
        if _matches_niimbot_name(name):
            print(f"[Niimbot] BLE 후보 발견: {name} ({device.address})")
            matches.append((name, device.address))

    if not matches:
        print("[Niimbot] BLE 검색에서는 Niimbot 이름이 보이지 않았습니다.")
    return matches


def find_niimbot_mac(timeout=5.0):
    matches = _run_async(discover_niimbot_ble_devices(timeout=timeout))
    return matches[0][1] if matches else None


def list_serial_candidates():
    try:
        from serial.tools.list_ports import comports
    except ImportError:
        print("[Niimbot] pyserial 모듈이 없어 시리얼 포트를 확인할 수 없습니다.")
        return []

    all_ports = list(comports())
    candidates = []

    for port in all_ports:
        device = _safe_text(getattr(port, "device", ""))
        description = _safe_text(getattr(port, "description", ""))
        hwid = _safe_text(getattr(port, "hwid", ""))
        haystack = f"{device} {description} {hwid}".upper()

        score = 0
        if "BLUETOOTH" in haystack:
            score += 30
        if "BTHENUM" in haystack:
            score += 20
        if _matches_niimbot_name(haystack):
            score += 100

        if score > 0:
            candidates.append((score, device, description, hwid))

    if not candidates and len(all_ports) == 1:
        only = all_ports[0]
        candidates.append(
            (
                1,
                _safe_text(getattr(only, "device", "")),
                _safe_text(getattr(only, "description", "")),
                _safe_text(getattr(only, "hwid", "")),
            )
        )

    candidates.sort(key=lambda item: (-item[0], item[1]))

    if candidates:
        print("[Niimbot] 시리얼 후보 포트:")
        for _, device, description, hwid in candidates:
            print(f"  - {device}: {description} [{hwid}]")
    else:
        print("[Niimbot] 시리얼 후보 포트를 찾지 못했습니다.")

    return [device for _, device, _, _ in candidates]


def _registry_key_to_mac(key_name):
    key_name = _safe_text(key_name).replace(":", "").replace("-", "")
    if len(key_name) != 12:
        return None
    return ":".join(key_name[i : i + 2].upper() for i in range(0, 12, 2))


def list_paired_niimbot_addresses():
    try:
        import winreg
    except ImportError:
        return {"ble": [], "btclassic": []}

    path = r"SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices"
    results = {"ble": [], "btclassic": []}
    seen = set()

    try:
        root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path)
    except OSError:
        return results

    index = 0
    while True:
        try:
            subkey_name = winreg.EnumKey(root, index)
        except OSError:
            break
        index += 1

        mac_address = _registry_key_to_mac(subkey_name)
        if not mac_address:
            continue

        try:
            subkey = winreg.OpenKey(root, subkey_name)
        except OSError:
            continue

        try:
            raw_name = winreg.QueryValueEx(subkey, "Name")[0]
        except OSError:
            raw_name = b""

        if isinstance(raw_name, (bytes, bytearray)):
            try:
                device_name = bytes(raw_name).decode("utf-8", errors="ignore").rstrip("\x00")
            except Exception:
                device_name = ""
        else:
            device_name = _safe_text(raw_name)

        if not _matches_niimbot_name(device_name):
            continue

        try:
            winreg.QueryValueEx(subkey, "LEName")
            addr_kind = "ble"
        except OSError:
            addr_kind = "btclassic"

        key = (addr_kind, mac_address)
        if key in seen:
            continue

        seen.add(key)
        results[addr_kind].append(mac_address)

    if results["ble"] or results["btclassic"]:
        print("[Niimbot] Windows 페어링 기록에서 찾은 D110 주소:")
        for kind in ("ble", "btclassic"):
            for address in results[kind]:
                print(f"  - {kind}: {address}")

    return results


def _build_attempts(port=None, mac_address=None, ble_scan_timeout=1.0):
    attempts = []
    seen = set()

    def add_attempt(kind, endpoint):
        endpoint = _safe_text(endpoint)
        if not endpoint:
            return
        key = (kind, endpoint.upper())
        if key in seen:
            return
        seen.add(key)
        attempts.append((kind, endpoint))

    if port:
        add_attempt("serial", port)

    if mac_address:
        add_attempt("ble", mac_address)

    for kind in ("ble", "serial", "btclassic"):
        add_attempt(kind, LAST_SUCCESSFUL_ENDPOINTS.get(kind, ""))

    paired = list_paired_niimbot_addresses()

    for address in paired["ble"]:
        add_attempt("ble", address)

    for address in paired["btclassic"]:
        add_attempt("btclassic", address)

    if not attempts and ble_scan_timeout:
        found_mac = find_niimbot_mac(timeout=ble_scan_timeout)
        if found_mac:
            add_attempt("ble", found_mac)

    for candidate in list_serial_candidates():
        add_attempt("serial", candidate)

    return attempts


def _connect_printer(port=None, mac_address=None, ble_scan_timeout=1.0):
    try:
        from niimprint import BleTransport, BluetoothTransport, PrinterClient, SerialTransport
    except ImportError as exc:
        raise RuntimeError(
            "niimprint 라이브러리를 찾을 수 없습니다. requirements 설치를 먼저 해주세요."
        ) from exc

    attempts = _build_attempts(
        port=port,
        mac_address=mac_address,
        ble_scan_timeout=ble_scan_timeout,
    )
    if not attempts:
        raise RuntimeError("COM 포트나 BLE 주소를 찾지 못했습니다.")

    failures = []

    for kind, endpoint in attempts:
        print(f"[Niimbot] {kind.upper()} 연결 시도: {endpoint}")
        try:
            if kind == "serial":
                transport = SerialTransport(endpoint)
            elif kind == "btclassic":
                transport = BluetoothTransport(endpoint)
            else:
                transport = BleTransport(endpoint)

            printer = PrinterClient(transport)
            print(f"[Niimbot] {kind.upper()} 연결 성공: {endpoint}")
            if kind == "ble":
                print("[Niimbot] BLE는 raw 전송 모드로 진행하므로 heartbeat를 생략합니다.")
            else:
                status = printer.heartbeat()
                print(f"[Niimbot] Heartbeat 상태: {status}")
            _remember_successful_endpoint(kind, endpoint)
            return printer, kind, endpoint
        except Exception as exc:
            failures.append(f"{kind}:{endpoint} -> {exc}")
            print(f"[Niimbot] {kind.upper()} 연결 실패: {endpoint} ({exc})")

    raise RuntimeError(" / ".join(failures))


def print_winner_label(
    num,
    item_name,
    winner_name,
    sold_price,
    winner_phone="",
    company="",
    mac_address=None,
    port=None,
    density=3,
    ble_scan_timeout=1.0,
    font_key=None,
    label_layout="auction",
):
    """
    Niimbot D110 라벨 인쇄.

    우선순위:
    1. 명시한 시리얼 포트 (예: COM7)
    2. PC에 잡힌 Bluetooth/Serial 후보 포트
    3. BLE 스캔으로 찾은 D110 계열 주소
    """
    img = create_label(
        num=num,
        item_name=item_name,
        winner_name=winner_name,
        sold_price=sold_price,
        winner_phone=winner_phone,
        company=company,
        font_key=font_key,
        label_layout=label_layout,
    )
    print(f"[Niimbot] 생성된 이미지 크기: {img.size} (W x H)")

    try:
        ble_targets = [
            endpoint
            for kind, endpoint in _build_attempts(
                port=port,
                mac_address=mac_address,
                ble_scan_timeout=ble_scan_timeout,
            )
            if kind == "ble"
        ]

        for ble_target in ble_targets:
            try:
                print(f"[Niimbot] direct BLE 우선 경로 사용: {ble_target}")
                success = _run_async(_direct_ble_print_image(ble_target, img, density=density))
                if success:
                    print("[Niimbot] OK direct BLE label print completed.")
                    _remember_successful_endpoint("ble", ble_target)
                    return True
            except Exception as ble_exc:
                print(f"[Niimbot] direct BLE 실패: {ble_target} ({ble_exc})")

        if ble_targets:
            print("[Niimbot] direct BLE 경로가 모두 실패하여 다른 경로를 시도합니다.")

        printer, transport_kind, endpoint = _connect_printer(
            port=port,
            mac_address=mac_address,
            ble_scan_timeout=0,
        )

        print(
            f"[Niimbot] 인쇄 데이터 전송 시작 ({transport_kind.upper()}: {endpoint}, density={density})"
        )
        _manual_print_image(printer, img, density=density)

        wait_seconds = 3 if transport_kind == "ble" else 2
        print(f"[Niimbot] 데이터 전송 완료. 장치 동작 대기 중... ({wait_seconds}초)")
        time.sleep(wait_seconds)

        print("[Niimbot] OK label print completed.")
        return True
    except Exception as exc:
        print(f"[Niimbot] 인쇄 실패: {exc}")
        traceback.print_exc()
        return False


def main():
    default_output_path = LABEL_OUTPUT_DIR / "test_label.png"
    parser = argparse.ArgumentParser(description="Niimbot D110 테스트 라벨 출력")
    parser.add_argument("--port", help="예: COM7")
    parser.add_argument("--mac", help="BLE 주소")
    parser.add_argument("--density", type=int, default=3, help="1~3 권장")
    parser.add_argument("--item-name", "--name", dest="item_name", default="테스트 개체")
    parser.add_argument("--winner", default="테스트 사용자")
    parser.add_argument("--phone", default="")
    parser.add_argument("--price", default="150만")
    parser.add_argument("--company", default="테스트 업체")
    parser.add_argument("--num", default="5")
    parser.add_argument("--layout", choices=["auction", "contact"], default="auction")
    parser.add_argument(
        "--output",
        default=str(default_output_path),
        help="생성한 테스트 이미지를 저장할 파일명",
    )
    parser.add_argument(
        "--skip-print",
        action="store_true",
        help="이미지만 생성하고 실제 인쇄는 하지 않음",
    )
    args = parser.parse_args()
    output_path = resolve_output_path(args.output, LABEL_OUTPUT_DIR)

    img = create_label(
        num=args.num,
        item_name=args.item_name,
        winner_name=args.winner,
        sold_price=args.price,
        winner_phone=args.phone,
        company=args.company,
        label_layout=args.layout,
    )
    img.save(output_path)
    print(f"테스트 이미지 저장 완료: {args.output} ({img.size})")

    if args.skip_print:
        return 0

    success = print_winner_label(
        num=args.num,
        item_name=args.item_name,
        winner_name=args.winner,
        sold_price=args.price,
        winner_phone=args.phone,
        company=args.company,
        mac_address=args.mac,
        port=args.port,
        density=args.density,
        label_layout=args.layout,
    )
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
