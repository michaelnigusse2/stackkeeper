#!/usr/bin/env python3
"""Verify every symbol imported from a workspace package is actually exported.

`tsc` does this once dependencies are installed. This runs without them, which
matters while the app layer cannot be compiled here.
"""
import pathlib, re, sys

from _walk import walk

PACKAGES = {
    "@stackkeeper/core": pathlib.Path("packages/core/src"),
    "@stackkeeper/db": pathlib.Path("packages/db/src"),
}

EXPORT = re.compile(
    r"^export\s+(?:declare\s+)?"
    r"(?:async\s+)?"
    r"(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)",
    re.M,
)
EXPORT_LIST = re.compile(r"^export\s+(?:type\s+)?\{([^}]*)\}", re.M)

def exports_of(root: pathlib.Path) -> set[str]:
    names: set[str] = set()
    for path in walk(root, {".ts"}):
        text = path.read_text()
        names.update(EXPORT.findall(text))
        for block in EXPORT_LIST.findall(text):
            for piece in block.split(","):
                piece = piece.strip()
                if not piece:
                    continue
                piece = piece.removeprefix("type ").strip()
                names.add(piece.split(" as ")[-1].strip())
    return names

# Generated and installed trees. Walking .next on Windows can raise an I/O
# error on its internal links, so these are skipped rather than filtered after
# the fact.
IMPORT = re.compile(
    r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*[\"'](@stackkeeper/[a-z]+)[\"']",
    re.S,
)

def main() -> int:
    available = {name: exports_of(path) for name, path in PACKAGES.items()}
    problems = []
    checked = 0

    for path in walk(pathlib.Path("apps"), {".ts", ".tsx"}):
        text = path.read_text()
        for block, package in IMPORT.findall(text):
            for piece in block.split(","):
                piece = piece.strip().removeprefix("type ").strip()
                if not piece:
                    continue
                symbol = piece.split(" as ")[0].strip()
                checked += 1
                if symbol not in available[package]:
                    problems.append(f"{path}: {package} does not export {symbol}")

    for problem in sorted(set(problems)):
        print(problem)
    print(f"\nChecked {checked} imported symbol(s); {len(set(problems))} problem(s).")
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main())
