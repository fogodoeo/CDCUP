from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
PRINT_OUTPUT_DIR = APP_DIR / "print_outputs"
LABEL_OUTPUT_DIR = PRINT_OUTPUT_DIR / "labels"
PREVIEW_OUTPUT_DIR = PRINT_OUTPUT_DIR / "previews"
FONT_COMPARISON_OUTPUT_DIR = PRINT_OUTPUT_DIR / "font_comparison"
LOG_OUTPUT_DIR = PRINT_OUTPUT_DIR / "logs"


def ensure_print_output_dirs():
    for path in (
        PRINT_OUTPUT_DIR,
        LABEL_OUTPUT_DIR,
        PREVIEW_OUTPUT_DIR,
        FONT_COMPARISON_OUTPUT_DIR,
        LOG_OUTPUT_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def resolve_output_path(path_value, default_dir):
    ensure_print_output_dirs()
    path = Path(path_value)
    target = default_dir / path.name if path.parent == Path(".") else path
    target.parent.mkdir(parents=True, exist_ok=True)
    return target
