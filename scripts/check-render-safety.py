#!/usr/bin/env python3
"""Find values that would crash React if rendered straight into JSX.

Rendering a Date throws "Objects are not valid as a React child", and it only
shows up when that row happens to have a value. Postgres `date` and
`timestamptz` columns all arrive as Date objects, so any JSX expression that
interpolates one of those fields without passing it through a formatter is a
crash waiting for the right data.

Run from the repository root:  python3 scripts/check-render-safety.py
"""
import pathlib
import re
import sys

from _walk import walk

# Column names that arrive from the driver as Date objects.
DATE_FIELDS = {
    "as_of", "checked_at", "created_at", "deleted_at", "ended_on", "expires_at",
    "last_checked_at", "manual_expires_at", "next_check_at", "next_renewal",
    "notified_at", "opened_at", "resolved_at", "started_on", "updated_at",
}

# jsonb columns and binary columns. React renders an object as a crash and a
# Buffer as nonsense, and neither can cross from a server component to a
# client one at all.
OBJECT_FIELDS = {"details", "data", "config", "payload", "secret"}

# Helpers that make a value safe to render.
SAFE = ("date(", "relativeDays(", "shortDays(", "daysUntil(", "toIsoDate(",
        "toISOString", "toLocale", "String(", "new Date(", "formatAlert(",
        "toDayString(", "getTime(", "JSON.stringify", "describe(",
        "Object.entries", "Object.keys", ".length", ".map(", ".join(",
        "typeof ", "!== null", "=== null", "Boolean(", "?.length")

# A JSX interpolation: {...} appearing as element content. Excludes a prop
# assignment (preceded by = or :) and an object literal passed as an argument
# (preceded by ( or ,), neither of which is rendered.
INTERPOLATION = re.compile(r"(?<![=:(,])\{([^{}]{1,200})\}")


def is_safe(expression: str) -> bool:
    return any(helper in expression for helper in SAFE)


# Generated and installed trees. Walking .next on Windows can raise an I/O
# error on its internal links, so these are skipped rather than filtered after
# the fact.
def main() -> int:
    findings = []
    for path in walk(pathlib.Path("apps"), {".tsx"}):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            for match in INTERPOLATION.finditer(line):
                expression = match.group(1)
                if is_safe(expression):
                    continue
                matched = False
                for field in DATE_FIELDS:
                    if re.search(rf"\.{field}\b", expression):
                        findings.append(f"{path}:{number}: renders .{field} (a Date) directly -> {expression.strip()}")
                        matched = True
                        break
                if matched:
                    continue
                for field in OBJECT_FIELDS:
                    if re.search(rf"\.{field}\b", expression):
                        findings.append(f"{path}:{number}: renders .{field} (an object) directly -> {expression.strip()}")
                        break

    for finding in findings:
        print(finding)
    print(f"\nScanned JSX in apps/; {len(findings)} unguarded render(s) of a Date or object.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
