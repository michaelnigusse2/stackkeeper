#!/usr/bin/env python3
"""Find date-valued expressions compared or concatenated without normalising.

There are two ways a date goes wrong in this codebase, and they are not the
same bug.

The loud one is a Date rendered straight into JSX: React throws
"Objects are not valid as a React child". `check-render-safety.py` catches it,
and you find out immediately because the page crashes.

The quiet one is worse. `startedOn < day` where `startedOn` is a Date and
`day` is a string coerces both to numbers, gets NaN, and is false -- every
time, silently. That bug shipped here: `isLineActive` used exactly that, so a
cancelled cost line kept counting toward a client's margin forever. Nothing
threw, and no test that only exercised active lines would have noticed.

This checks the quiet shape. A value carrying a date must pass through a
normaliser (toIsoDate, toDayString, getTime, toISOString, ...) before being
compared with < > <= >= === !== or concatenated with +.

Deliberately not reported, because they are safe:
  - `x !== null` and friends -- a null check never coerces.
  - anything inside a SQL template -- Postgres does that comparison itself,
    in the database, with real date types.
  - the field name inside a string literal -- <input name="nextRenewal"> is
    a form field, not a date.
  - `typeof x === "string"` -- that is the guard, not the mistake.
  - a local already assigned from a normaliser earlier in the file.
"""
import pathlib
import re
import sys

from _walk import walk

DATE_FIELDS = [
    "as_of", "asOf", "checked_at", "checkedAt", "created_at", "createdAt",
    "deleted_at", "deletedAt", "ended_on", "endedOn", "expires_at", "expiresAt",
    "last_checked_at", "lastCheckedAt", "manual_expires_at", "manualExpiresAt",
    "next_check_at", "nextCheckAt", "next_renewal", "nextRenewal",
    "notified_at", "notifiedAt", "opened_at", "openedAt",
    "resolved_at", "resolvedAt", "started_on", "startedOn",
    "updated_at", "updatedAt",
]
NORMALISERS = (
    "toIsoDate", "toDayString", "getTime", "valueOf", "toISOString",
    "Date.parse", "parseDate", "formatDate", "formatDay", "formatWhen",
    "relativeDays", "shortDays", "daysUntil", "new Date",
)
SQL_VERBS = r"select|insert|update|delete|with|create|alter|drop|set|begin|commit|grant|revoke"

FIELD_RE = re.compile(r"(\.?)\b(" + "|".join(DATE_FIELDS) + r")\b")
RELATIONAL = re.compile(r"<=|>=|<|>|===|!==|(?<![+\w])\+(?!\+)")
NULL_CMP = re.compile(r"[!=]==?\s*(?:null|undefined)|(?:null|undefined)\s*[!=]==?")
TYPEOF_GUARD = re.compile(r"typeof\s+[\w.?\[\]]+\s*[!=]==?\s*[\"']")
STRING_LITERAL = re.compile(r"\"[^\"]*\"|'[^']*'")
# An opening or closing JSX tag, or a self-closing end. Also catches a
# TypeScript generic like `Array<Row>`, which is likewise not a comparison.
JSX_TAG = re.compile(r"</?[A-Za-z][\w.:-]*|/>")
SQL_START = re.compile(r"\s*(?:" + SQL_VERBS + r")\b", re.IGNORECASE)
NORMALISED_LOCAL = re.compile(
    r"\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*[^;]*?(?:" 
    + "|".join(re.escape(n) for n in NORMALISERS) + r")"
)




def sql_line_numbers(text):
    """Line numbers (1-based) falling inside a template that holds SQL.

    Detected by what the template contains, not by its tag: queries here are
    written as tx<Row[]>`...` and ownerTx<Row[]>`...`, so looking for a tag
    named `sql` finds almost none of them. Interpolations in this codebase are
    simple values, so the next backtick really does close the template.
    """
    inside = set()
    i = 0
    while True:
        open_tick = text.find("`", i)
        if open_tick == -1:
            return inside
        close_tick = text.find("`", open_tick + 1)
        if close_tick == -1:
            return inside
        body = text[open_tick + 1 : close_tick]
        if SQL_START.match(body):
            first = text.count("\n", 0, open_tick) + 1
            last = text.count("\n", 0, close_tick) + 1
            inside.update(range(first, last + 1))
        i = close_tick + 1


def masked(line):
    """The line with string literals, arrows and JSX tags blanked.

    String literals hide form-field names (name="nextRenewal"); arrows hide
    both JS arrow functions and Postgres named arguments (days => $1), whose
    `>` would otherwise read as a comparison.

    JSX is the subtle one. In a .tsx file `<span className={...}>` is markup,
    but its angle brackets are indistinguishable from `<` and `>` by pattern
    alone, so every JSX line mentioning a date field looked like an unguarded
    comparison. A tag is recognised by the bracket being followed immediately
    by an identifier character, which real comparisons are not: those are
    written `a < b`, with the space that this codebase's formatter enforces.
    """
    line = STRING_LITERAL.sub(lambda m: " " * len(m.group(0)), line)
    line = line.replace("=>", "  ")
    line = JSX_TAG.sub(lambda m: " " * len(m.group(0)), line)
    return line


def main():
    findings = []
    for base in ("apps", "packages"):
        root = pathlib.Path(base)
        if not root.exists():
            continue
        for path in walk(root, {".ts", ".tsx"}):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            sql_lines = sql_line_numbers(text)
            safe_locals = set(NORMALISED_LOCAL.findall(text))
            for n, raw in enumerate(text.splitlines(), 1):
                if n in sql_lines:
                    continue
                stripped = raw.strip()
                if stripped.startswith(("//", "*", "/*")):
                    continue
                if TYPEOF_GUARD.search(raw):
                    continue
                # A line carrying JSX markup is not this checker's business.
                # Masking a tag's opening still leaves the `>` that closes it,
                # and chasing that through attributes containing their own
                # braces and comparisons is a parser, not a regex. Rendering a
                # date into JSX is already check-render-safety.py's job; the
                # quiet comparison bug lives in logic, which sits on lines with
                # no markup on them.
                if JSX_TAG.search(raw):
                    continue

                line = masked(raw)
                match = FIELD_RE.search(line)
                if not match:
                    continue
                dotted, name = match.group(1), match.group(2)
                # A bare local already normalised further up the file is fine.
                if not dotted and name in safe_locals:
                    continue
                # Is THIS occurrence normalised, or does it merely share a
                # line with a normaliser? "Does the line mention one" excuses
                # `toIsoDate(cutoff) < row.started_on`, where the call wraps
                # the other operand and this one is still raw. A character
                # window has the same hole, just a smaller one.
                #
                # So: walk back over the whole property access to find where
                # the expression starts, and ask what sits immediately before
                # it. `toIsoDate(row.started_on)` is preceded by the call's
                # open bracket; `... < row.started_on` is preceded by an
                # operator. Only the first is wrapped.
                start = match.start()
                while start > 0 and (line[start - 1].isalnum() or line[start - 1] in "_$.[]"):
                    start -= 1
                before = line[:start].rstrip()
                after = line[match.end() : match.end() + 24].lstrip()

                if any(before.endswith(f"{norm}(") for norm in NORMALISERS):
                    continue
                if any(after.startswith(f".{norm}") for norm in
                       ("getTime", "valueOf", "toISOString", "toLocaleDateString")):
                    continue
                if not RELATIONAL.search(line):
                    continue
                if NULL_CMP.search(line) and not re.search(r"<=|>=|<|>", line):
                    continue
                # A type annotation or object-literal key is not a comparison.
                if re.search(r"\b" + name + r"\s*[?:]", line):
                    continue
                findings.append((path, n, stripped))

    for path, n, text in findings:
        print(f"{path}:{n}: {text}")

    if findings:
        print(
            f"\n{len(findings)} date value(s) compared without normalising. "
            "Pass them through toIsoDate/toDayString first -- comparing a Date "
            "against a string is always false, and fails silently."
        )
        return 1

    print("Scanned apps/ and packages/; 0 unnormalised date comparison(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
