#!/usr/bin/env python3
"""Check every theme's text colours against the surfaces they sit on.

Contrast regresses silently. Someone nudges a grey two points lighter because
it looked heavy on their monitor, and a caption drops to 4.2:1 -- still legible
to the person who just wrote it and knows what it says, illegible to someone
reading it in daylight. Nothing warns, and no other check in this repo looks at
colour values at all.

Two surfaces matter, not one. Checking only against the page background misses
the fill behind a search field or a soft button, which is lighter than the page
in dark mode and darker than it in light mode -- and that is where a muted grey
actually fails first. That is not hypothetical: the light theme's caption grey
passed on white at 4.79:1 and failed on the soft fill at 4.35:1.

WCAG 2.1 AA wants 4.5:1 for normal text and 3:1 for text at 24px or above.
Everything checked here is small text, so 4.5:1 throughout.
"""
import pathlib
import re
import sys

from _walk import find

MINIMUM = 4.5

# Every theme block, by the selector that opens it.
THEMES = (
    (":root {", "light"),
    ('[data-theme="dark"]', "dark"),
    (':root:not([data-theme="light"])', "dark (system)"),
)

# Tokens that carry small text, and the surfaces they can land on.
TEXT_TOKENS = ("--text", "--text-2", "--muted", "--faint", "--accent",
               "--ok", "--warn", "--crit", "--info")
SURFACES = ("--bg", "--raised", "--sunken")

# Comments mention selectors in prose. A selector inside one is not a rule, and
# matching it finds the *next* block instead -- which silently audited the light
# theme twice and reported the dark theme as passing without ever reading it.
COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
DECL = re.compile(r"(--[\w-]+)\s*:\s*([^;]+);")


def luminance(value: str) -> float:
    h = value.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    parts = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in parts]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def theme_block(css: str, selector: str):
    """The declarations inside the first real rule with this selector."""
    try:
        at = css.index(selector)
    except ValueError:
        return None
    open_brace = css.index("{", at)
    depth, i = 0, open_brace
    while i < len(css):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return dict(DECL.findall(css[open_brace + 1:i]))


def main() -> int:
    sheets = sorted(find("apps", "globals.css"))
    if not sheets:
        print("no globals.css found, refusing to check nothing.", file=sys.stderr)
        return 1

    failures = []
    checked = 0

    for sheet in sheets:
        raw = sheet.read_text(encoding="utf-8")
        css = COMMENT.sub(lambda m: " " * len(m.group(0)), raw)

        for selector, label in THEMES:
            tokens = theme_block(css, selector)
            if not tokens:
                failures.append((label, f"theme block {selector} not found"))
                continue

            for surface in SURFACES:
                if surface not in tokens:
                    continue
                bg = tokens[surface]
                if not bg.strip().startswith("#"):
                    continue
                for token in TEXT_TOKENS:
                    if token not in tokens:
                        continue
                    fg = tokens[token]
                    if not fg.strip().startswith("#"):
                        continue
                    ratio = contrast(fg, bg)
                    checked += 1
                    if ratio < MINIMUM:
                        failures.append(
                            (label, f"{token} ({fg.strip()}) on {surface} ({bg.strip()})"
                                    f" = {ratio:.2f}:1")
                        )

            # The one light-on-dark pair: the primary action.
            if "--strong" in tokens and "--on-strong" in tokens:
                ratio = contrast(tokens["--on-strong"], tokens["--strong"])
                checked += 1
                if ratio < MINIMUM:
                    failures.append((label, f"primary button = {ratio:.2f}:1"))

    for label, detail in failures:
        print(f"  {label}: {detail}")

    if failures:
        print(f"\n{len(failures)} colour pair(s) below {MINIMUM}:1. Small text at that "
              "contrast is readable to whoever picked it and to few others.")
        return 1

    print(f"Checked {checked} colour pair(s) across every theme; all clear {MINIMUM}:1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
