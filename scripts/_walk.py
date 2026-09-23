"""Shared file walking for the check scripts.

This exists because the same bug was written three times.

`pathlib.rglob` descends into everything, including `apps/web/.next`, where
the dev server leaves symlinks that raise `OSError: [Errno 5] Input/output
error` when the project sits on a Windows filesystem read through a Linux
mount. Each checker grew its own `walk()` in response, and the fourth one --
written months later, in a hurry -- used `rglob` again and crashed on the
user's machine the moment it ran there.

So there is one copy now, and new checkers import it. A checker that needs to
find files has no business writing its own traversal.

Run as `python3 scripts/<name>.py` from the repository root; Python puts the
script's own directory on `sys.path`, so `from _walk import walk` resolves.
"""
import pathlib

# Generated and vendored directories. Nothing here is source, and `.next` in
# particular is actively hostile to traversal.
SKIP_DIRS = {
    ".next", "node_modules", "dist", "build", "out", ".turbo", ".git",
    "coverage", ".vercel", ".cache",
}


def walk(root, suffixes=None):
    """Yield source files under `root`, never descending into a generated dir.

    `suffixes` is a set like {".ts", ".tsx"}; omit it to yield every file.
    Directories that cannot be read are skipped rather than raising, because a
    single unreadable entry should not take down a whole check.
    """
    root = pathlib.Path(root)
    try:
        entries = sorted(root.iterdir())
    except OSError:
        return
    for path in entries:
        try:
            is_dir = path.is_dir()
        except OSError:
            continue
        if is_dir:
            if path.name in SKIP_DIRS:
                continue
            yield from walk(path, suffixes)
        elif suffixes is None or path.suffix in suffixes:
            yield path


def find(root, filename):
    """Every file with this exact name under `root`."""
    return [p for p in walk(root) if p.name == filename]
