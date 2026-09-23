#!/usr/bin/env python3
"""Pull the SQL out of `tx` tagged templates and turn it into PREPARE
statements, so every repository query can be checked against the real schema.

Interpolations become numbered placeholders. Brace depth is tracked so that an
expression containing an object literal, such as ${tx.json(x ?? {})}, is
replaced as a whole.
"""
import pathlib
import re
import sys

# Anchored to this file, never to the current directory. Invoked from the
# repository root -- which is how CI invokes it -- a relative "src/repo"
# resolves to nothing, and a directory that does not exist is skipped, so the
# check would pass having parsed no queries at all.
PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parent.parent
SOURCE_DIRS = [
    PACKAGE_ROOT / "src" / "repo",
    PACKAGE_ROOT / "src",
    # The worker writes SQL inline too (the purge query, the rate refresh).
    # Those queries run against the same schema and can rot the same way.
    REPO_ROOT / "apps" / "worker" / "src",
]
# An identifier ending in tx/Tx/sql/Sql -- `tx`, `ownerTx`, `sql` -- optionally
# followed by a type argument, then the template. The generic is skipped by
# counting angle brackets rather than by regex: `sql<Array<{ n: number }>>` is
# nested, and a non-greedy <...> stops at the first `>` and never reaches the
# backtick, which is how two live worker queries went unchecked.
TAG_NAME = re.compile(r"\b[A-Za-z_$][A-Za-z0-9_$]*\b")


def tag_positions(text: str):
    """Yield the index just past the opening backtick of each SQL template."""
    for match in TAG_NAME.finditer(text):
        name = match.group(0)
        if not (name.endswith(("tx", "Tx", "sql", "Sql"))):
            continue
        i = match.end()
        while i < len(text) and text[i] in " \t":
            i += 1
        if i < len(text) and text[i] == "<":
            depth = 0
            while i < len(text):
                if text[i] == "<":
                    depth += 1
                elif text[i] == ">":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                elif text[i] == "`":
                    break
                i += 1
            while i < len(text) and text[i] in " \t":
                i += 1
        if i < len(text) and text[i] == "`":
            yield i + 1


def split_template(text: str, start: int):
    """Return (body, end_index) for the template literal opening at `start`."""
    out, i, depth = [], start, 0
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch == "`" and depth == 0:
            return "".join(out), i
        if text.startswith("${", i):
            depth, j = 1, i + 2
            while j < len(text) and depth:
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                j += 1
            out.append("\x00")  # placeholder marker
            i = j
            depth = 0
            continue
        out.append(ch)
        i += 1
    raise ValueError("unterminated template literal")


def strip_comments(text: str) -> str:
    """Blank out comments, keeping length so reported offsets stay usable.

    A doc comment mentioning a handle in backticks, such as `ownerTx`, would
    otherwise look exactly like the start of a tagged template.
    """
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end == -1 else end + 2
            for j in range(i, end):
                if out[j] != "\n":
                    out[j] = " "
            i = end
            continue
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end == -1 else end
            for j in range(i, end):
                out[j] = " "
            i = end
            continue
        i += 1
    return "".join(out)


def extract(path: pathlib.Path):
    text = strip_comments(path.read_text())
    for start in tag_positions(text):
        body, _ = split_template(text, start)
        if "\x00" not in body and not body.strip():
            continue
        sql, n = [], 0
        for part in body.split("\x00"):
            sql.append(part)
            n += 1
            sql.append(f"${n}")
        statement = "".join(sql[:-1]).strip()
        if statement:
            yield path.name, statement


def main() -> int:
    seen = set()
    count = 0
    missing = [str(d) for d in SOURCE_DIRS if not d.is_dir()]
    if missing:
        print(
            "source directory missing, refusing to check nothing: "
            + ", ".join(missing),
            file=sys.stderr,
        )
        return 1

    for base in SOURCE_DIRS:
        for path in sorted(base.glob("*.ts")):
            for name, statement in extract(path):
                key = (name, statement)
                if key in seen:
                    continue
                seen.add(key)
                count += 1
                print(f"\\echo checking {name} #{count}")
                print(f"prepare q{count} as {statement};")
                print(f"deallocate q{count};")
    if count == 0:
        print("-- no queries found", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
