#!/usr/bin/env python3
"""Find CSS classes used in JSX that no stylesheet defines.

A restyle fails quietly. Rename a class in the stylesheet, miss one page, and
that page keeps rendering -- just unstyled, in whatever the browser defaults
to. Nothing throws, no test fails, and you only notice by opening that page.
With twenty pages sharing one stylesheet, "I checked them all" is not a claim
worth trusting.

So: every class name that appears in a className in `apps/`, checked against
every class actually defined in the CSS. A class used but never defined is an
error. A class defined but never used is only reported when asked for with
--unused, since a stylesheet is allowed to carry a few spare parts.

Every form of the attribute is read, because each one hid a real bug:

  className="a b"                     a plain string
  className={"a b"}                   a string in braces
  className={`a ${tone} b`}           a template literal
  className={cond ? "a b" : "a"}      an arbitrary expression

The first three were handled and the fourth was not, which meant `.menu` and
`.up` -- written as a ternary -- were invisible: they would not have been
reported had the stylesheet never defined them. So the brace form is now
scanned whole and every quoted string inside it is treated as class names.
A `${...}` hole contributes nothing, since what it evaluates to is unknowable
from the source; a quoted string inside one does contribute, because inside a
className a quoted string can only be a class.
"""
import pathlib
import re
import sys

from _walk import walk


# className="a b", className={"a b"}, className={`a ${x} b`}
CLASSNAME = re.compile(
    r"className\s*=\s*(?:\{\s*)?(?:\"([^\"]*)\"|'([^']*)'|`([^`]*)`)",
    re.DOTALL,
)
# Any `${ ... }` hole inside a template literal.
HOLE = re.compile(r"\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}")
# A class definition in CSS. The character after the dot must start an
# identifier, which is what separates `.badge` from the `.875` in `0.875rem`.
# Deliberately no lookbehind on the dot: that would skip the second class of a
# compound selector, so `.badge.critical` would define `badge` and silently not
# `critical` -- which is exactly the kind of quiet gap this script exists to
# catch, and it had it.
CSS_CLASS = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
# Strip comments, strings and url() so their contents cannot look like
# selectors (`url(sprite.png)` would otherwise define a class named `png`).
CSS_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
CSS_STRING = re.compile(r"\"[^\"]*\"|'[^']*'")
CSS_URL = re.compile(r"url\([^)]*\)", re.IGNORECASE)




ANY_QUOTED = re.compile(r"\"([^\"]*)\"|'([^']*)'|`([^`]*)`")

# A string that is an operand of a comparison is a value being tested, not a
# class: `flag.code === "no_charge" ? "badge critical" : ...` mentions two
# kinds of string and only one of them ends up in the class attribute.
COMPARED = re.compile(
    r"(?:===|!==|==|!=)\s*(\"[^\"]*\"|'[^']*'|`[^`]*`)"
    r"|(\"[^\"]*\"|'[^']*'|`[^`]*`)\s*(?:===|!==|==|!=)"
)


def strip_compared(source: str) -> str:
    """Blank out strings that sit on either side of a comparison."""
    return COMPARED.sub(lambda m: " " * len(m.group(0)), source)


def classname_sources(text):
    """Yield (offset, source) for every className attribute value.

    A plain string yields the string; a braced expression yields the whole
    expression, brace-balanced, so a ternary or a helper call is captured
    rather than skipped.
    """
    for match in re.finditer(r"className\s*=\s*", text):
        i = match.end()
        if i >= len(text):
            continue
        ch = text[i]
        if ch in "\"'":
            end = text.find(ch, i + 1)
            if end != -1:
                yield match.start(), text[i : end + 1]
            continue
        if ch != "{":
            continue
        depth, j, quote = 0, i, ""
        while j < len(text):
            c = text[j]
            if quote:
                if c == quote:
                    quote = ""
            elif c in "\"'`":
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        yield match.start(), text[i : j + 1]


def used_classes(root):
    """Map class name -> sorted list of "file:line" where it appears."""
    found = {}
    for path in walk(root, {".tsx", ".jsx"}):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for offset, source in classname_sources(text):
            line = text.count("\n", 0, offset) + 1
            # A `${...}` hole evaluates to something unknowable, so it
            # contributes nothing -- but a quoted string anywhere in the
            # expression, holes included, is a class name.
            cleaned = strip_compared(source)
            for quoted in ANY_QUOTED.findall(HOLE.sub(" ", cleaned)):
                for name in (quoted[0] or quoted[1] or quoted[2]).split():
                    if not re.fullmatch(r"-?[_a-zA-Z][\w-]*", name):
                        continue
                    found.setdefault(name, []).append(f"{path}:{line}")
            for hole in HOLE.findall(cleaned):
                for quoted in ANY_QUOTED.findall(hole):
                    for name in (quoted[0] or quoted[1] or quoted[2]).split():
                        if not re.fullmatch(r"-?[_a-zA-Z][\w-]*", name):
                            continue
                        found.setdefault(name, []).append(f"{path}:{line}")
    return found


def defined_classes(paths):
    """Every class name defined across the given stylesheets."""
    defined = set()
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        text = CSS_COMMENT.sub(" ", text)
        text = CSS_STRING.sub(" ", text)
        text = CSS_URL.sub(" ", text)
        defined.update(CSS_CLASS.findall(text))
    return defined


# A control must carry one of these, or it renders as a bare browser button.
BUTTON_BASES = {"button", "icon-button", "chip", "theme-option", "account-trigger",
                "sidebar-toggle"}


def tag_bodies(text, tag):
    """Yield the source text of each `<tag ...>` opening tag.

    Not a regex, because `[^>]*` is wrong here: an attribute like
    `onClick={() => setEditing(false)}` contains a `>` that does not close the
    tag. So scan forward tracking brace depth and quotes, and take the first
    `>` that is genuinely outside both.
    """
    needle = f"<{tag}"
    i = 0
    while True:
        start = text.find(needle, i)
        if start == -1:
            return
        # `<buttonish` is a different tag.
        after = text[start + len(needle) : start + len(needle) + 1]
        if after and (after.isalnum() or after in "_-"):
            i = start + len(needle)
            continue
        depth = 0
        quote = ""
        j = start + len(needle)
        while j < len(text):
            ch = text[j]
            if quote:
                if ch == quote:
                    quote = ""
            elif ch in "\"'`":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            elif ch == ">" and depth == 0:
                break
            j += 1
        yield start, text[start:j]
        i = j + 1


def unstyled_buttons(root):
    """Buttons whose className has literal classes but no base class.

    The class-existence check above cannot see this: every one of `small`,
    `quiet` and `primary` is defined -- as `.button.small`, `.button.quiet`,
    `.button.primary`. A button carrying only those matches none of them and
    renders as a raw browser button. That shipped, on eight controls.

    A button with no className at all is left alone: several are styled by a
    descendant rule (`thead th button`). A fully dynamic className cannot be
    judged from the source and is left alone too.
    """
    problems = []
    for path in walk(root, {".tsx", ".jsx"}):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for offset, body in tag_bodies(text, "button"):
            match = CLASSNAME.search(body)
            if not match:
                continue
            raw = next(g for g in match.groups() if g is not None)
            literal = HOLE.sub(" ", raw)
            names = [n for n in literal.split() if re.fullmatch(r"-?[_a-zA-Z][\w-]*", n)]
            if not names:
                continue
            if any(name in BUTTON_BASES for name in names):
                continue
            line = text.count("\n", 0, offset) + 1
            problems.append((f"{path}:{line}", " ".join(names)))
    return problems


# `--name:` declared, and `var(--name)` used with no fallback.
CSS_VAR_DEF = re.compile(r"(--[\w-]+)\s*:")
CSS_VAR_PAIR = re.compile(r"(--[\w-]+)\s*:\s*([^;}]+)")
# A value that paints something, as opposed to a length, a font stack or a
# duration. Only these need a dark counterpart.
IS_COLOUR = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|color-mix\(|oklch\()")
CSS_VAR_USE = re.compile(r"var\(\s*(--[\w-]+)\s*\)")


def dangling_variables(root, sheets):
    """Custom properties that are used but never declared.

    CSS fails these silently and expensively: `border: 1px solid var(--gone)`
    is invalid at computed-value time, so the browser throws away the whole
    declaration and the element simply has no border. Nothing warns. Renaming
    a token -- `--border` to `--edge`, say -- leaves exactly this behind.

    Only uses without a fallback are reported: `var(--maybe, 1px)` is a
    deliberate default, not a mistake.
    """
    declared = set()
    for path in sheets:
        try:
            declared.update(CSS_VAR_DEF.findall(path.read_text(encoding="utf-8")))
        except OSError:
            continue

    problems = []
    for path in list(sheets) + list(walk(root, {".tsx", ".jsx", ".ts"})):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for match in CSS_VAR_USE.finditer(text):
            name = match.group(1)
            if name in declared:
                continue
            line = text.count("\n", 0, match.start()) + 1
            problems.append((f"{path}:{line}", name))
    return problems


# The selectors that define a theme's tokens.
THEME_BLOCKS = (
    (":root", "light"),
    ('[data-theme="dark"]', "dark"),
    (':root:not([data-theme="light"])', "dark (system)"),
)


def block_after(text, selector):
    """The body of the first rule with exactly this selector, or None."""
    i = 0
    while True:
        at = text.find(selector, i)
        if at == -1:
            return None
        # The selector must be followed by `{`, and preceded by nothing that
        # would make it part of a longer selector.
        j = at + len(selector)
        while j < len(text) and text[j] in " \n\t":
            j += 1
        before = text[at - 1] if at > 0 else "\n"
        if j < len(text) and text[j] == "{" and before in "\n\t }":
            depth = 0
            for k in range(j, len(text)):
                if text[k] == "{":
                    depth += 1
                elif text[k] == "}":
                    depth -= 1
                    if depth == 0:
                        return text[j + 1 : k]
            return None
        i = at + len(selector)


def theme_gaps(sheets):
    """Tokens a theme defines that another theme does not.

    Two ways this bites. A token declared only under `[data-theme="dark"]` is
    undefined in light mode, so every declaration using it is thrown away and
    the element loses that property entirely -- and it looks perfect while you
    are testing in dark mode. A token in `:root` with no dark counterpart is
    quieter but still wrong: dark inherits the light value, so one colour stays
    light while everything around it turns dark.
    """
    problems = []
    for path in sheets:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        text = CSS_COMMENT.sub(" ", text)

        blocks = {}
        values = {}
        for selector, name in THEME_BLOCKS:
            body = block_after(text, selector)
            if body is None:
                continue
            blocks[name] = set(CSS_VAR_DEF.findall(body))
            if name == "light":
                values = dict(CSS_VAR_PAIR.findall(body))

        if "light" not in blocks:
            continue

        for name, tokens in blocks.items():
            if name == "light":
                continue

            # Defined only in a dark block: undefined in light, so every
            # declaration using it is discarded there. Always wrong.
            for token in sorted(tokens - blocks["light"]):
                problems.append((str(path), token, f"{name} only -- undefined in light"))

            # Defined only in light: dark inherits the light value. That is
            # correct and intended for spacing, radii, fonts and sizes -- dark
            # mode does not change the layout. It is a bug only for colours,
            # which is what the value test below distinguishes.
            for token in sorted(blocks["light"] - tokens):
                if IS_COLOUR.match(values.get(token, "").strip()):
                    problems.append(
                        (str(path), token, f"a colour defined only in light -- {name} inherits it")
                    )
    return problems


# Containers that wrap a popover somewhere inside them. A popover is absolutely
# positioned and deliberately overflows its parent, so any of these setting a
# clipping `overflow` makes it vanish.
#
# This is not hypothetical. `.topbar-inner` was given `overflow: hidden` so the
# nav's horizontal scroll would clip to the bar's rounded corners. The account
# menu drops out of that same bar, so it was clipped too: clicking the avatar
# opened a menu that painted nothing, and the appearance control looked as
# though it had never been built. It shipped that way and a person had to
# report it.
#
# Ancestry cannot be derived from CSS, and deriving it from JSX means resolving
# components across files. An explicit list is worth more than a clever
# analysis here, because the set of shell containers changes about once a year.
POPOVER_ANCESTORS = ("shell", "sidebar", "sidebar-foot", "account",
                     "header-search", "main")
CLIPPING = ("hidden", "auto", "scroll", "clip")


def clipping_ancestors(sheets):
    """Shell containers that would clip a popover out of existence."""
    problems = []
    for path in sheets:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        text = CSS_COMMENT.sub(lambda m: " " * len(m.group(0)), text)
        for name in POPOVER_ANCESTORS:
            body = block_after(text, f".{name}")
            if body is None:
                continue
            for prop in ("overflow", "overflow-x", "overflow-y"):
                for decl in re.findall(rf"(?<![\w-]){re.escape(prop)}\s*:\s*([^;}}]+)", body):
                    value = decl.strip().lower()
                    # overflow-y: hidden alone does not clip a menu dropping
                    # downward out of a bar... but it does clip it vertically,
                    # which is exactly the case that broke. Treat any clip as a
                    # problem on these containers.
                    if any(word in value.split() for word in CLIPPING):
                        problems.append((str(path), name, f"{prop}: {value}"))
    return problems


def blank_comments(text):
    """Comments replaced by spaces, newlines kept.

    The obvious `" " * len(match)` turns a ten-line comment into one very long
    line, and every line number reported after it is wrong by ten. That is how
    this rule first pointed at `.notice.boxed` for a problem in `.field`.
    """
    return CSS_COMMENT.sub(
        lambda m: "".join("\n" if c == "\n" else " " for c in m.group(0)), text
    )


# Properties a "bare control" rule zeroes out: the ones you write when a field
# has to disappear into a pill or a toolbar rather than look like a form field.
RESET_PROPS = ("padding", "border", "border-radius", "background", "min-height",
               "height", "width", "outline", "font-size")

# `.something input`, and nothing else -- specificity (0, 1, 1).
SCOPED_ELEMENT = re.compile(r"^\.[\w-]+\s+(input|select|textarea|button)$")
# `input[type="search"]` -- a type selector with at least one attribute, and no
# class. One attribute puts it at (0, 1, 1), level with `.something input`;
# fewer and it loses on specificity whatever the order, so it is not a problem.
GENERIC_ELEMENT = re.compile(r"^(input|select|textarea|button)((?:\[[^\]]*\])+)$")


def top_level_rules(text):
    """Every rule in the sheet as (order, [selector], body), @media included.

    Order is the position in the file, which is what decides a tie between two
    selectors of equal specificity -- the whole point of this rule.
    """
    rules = []

    def scan(chunk, offset):
        i = 0
        while i < len(chunk):
            brace = chunk.find("{", i)
            if brace == -1:
                return
            prelude = chunk[i:brace].strip()
            depth = 0
            end = -1
            for k in range(brace, len(chunk)):
                if chunk[k] == "{":
                    depth += 1
                elif chunk[k] == "}":
                    depth -= 1
                    if depth == 0:
                        end = k
                        break
            if end == -1:
                return
            body = chunk[brace + 1 : end]
            if prelude.startswith("@"):
                # @media and friends hold rules, not declarations. Descend.
                if "{" in body:
                    scan(body, offset + brace + 1)
            else:
                selectors = [s.strip() for s in prelude.split(",") if s.strip()]
                rules.append((offset + brace, selectors, body))
            i = end + 1

    scan(text, 0)
    return rules


def declared_properties(body):
    """Property names set directly in this body, shorthands included."""
    names = set()
    for line in body.split(";"):
        if "{" in line or "}" in line:
            continue
        head, sep, _ = line.partition(":")
        if not sep:
            continue
        name = head.strip().lower()
        if name and not name.startswith("--"):
            names.add(name)
    return names


def overridden_resets(sheets):
    """A bare-control rule that a later, equally specific rule undoes.

    `.header-search input` and `input[type="search"]` both score (0, 1, 1).
    Nothing separates them but where they sit in the file, and the generic
    control rule sits later, so it won: the search field drew its own border
    and padding inside the pill and stood 34px tall in a 32px box. It looked
    like a field jammed into a slot too small for it, which is how it was
    reported.

    Specificity is the fix -- a second class, not a lucky position -- so this
    flags any `.x input` rule written before a generic rule for the same
    element that sets the same properties.
    """
    problems = []
    for path in sheets:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        text = blank_comments(text)
        rules = top_level_rules(text)

        # Every generic control rule, by element, with where it sits.
        generic = []
        for order, selectors, body in rules:
            props = declared_properties(body)
            if not props:
                continue
            for selector in selectors:
                m = GENERIC_ELEMENT.match(selector)
                if m:
                    generic.append((order, m.group(1), props))
                    break

        for order, selectors, body in rules:
            props = declared_properties(body)
            reset = props & set(RESET_PROPS)
            if not reset:
                continue
            for selector in selectors:
                m = SCOPED_ELEMENT.match(selector)
                if not m:
                    continue
                element = m.group(1)
                for g_order, g_element, g_props in generic:
                    if g_element != element or g_order <= order:
                        continue
                    clash = sorted(reset & g_props)
                    if clash:
                        line = text.count("\n", 0, order) + 1
                        problems.append((f"{path}:{line}", selector, element,
                                         ", ".join(clash)))
                        break
    return problems


def main():
    want_unused = "--unused" in sys.argv

    app_root = pathlib.Path("apps")
    if not app_root.is_dir():
        print("apps/ not found -- run this from the repository root.", file=sys.stderr)
        return 1

    sheets = sorted(walk(app_root, {".css"}))
    if not sheets:
        print("no stylesheet found, refusing to check nothing.", file=sys.stderr)
        return 1

    used = used_classes(app_root)
    defined = defined_classes(sheets)

    if not used:
        print("no className found, refusing to check nothing.", file=sys.stderr)
        return 1

    missing = sorted(name for name in used if name not in defined)
    bare = unstyled_buttons(app_root)
    dangling = dangling_variables(app_root, sheets)
    gaps = theme_gaps(sheets)
    clipped = clipping_ancestors(sheets)
    losers = overridden_resets(sheets)

    for name in missing:
        where = used[name]
        shown = ", ".join(where[:3])
        more = f" (+{len(where) - 3} more)" if len(where) > 3 else ""
        print(f"  .{name} -- used but never defined: {shown}{more}")

    if want_unused:
        unused = sorted(name for name in defined if name not in used)
        if unused:
            print("\ndefined but unused (not an error):")
            for name in unused:
                print(f"  .{name}")

    for where, names in bare:
        print(f"  <button className=\"{names}\"> has no base class: {where}")

    for where, name in dangling:
        print(f"  var({name}) is never declared: {where}")

    for path, token, why in gaps:
        print(f"  {token} is {why}: {path}")

    for path, name, decl in clipped:
        print(f"  .{name} sets {decl} -- it wraps a popover, which it will clip: {path}")

    for where, selector, element, props in losers:
        print(
            f"  `{selector}` sets {props}, and a later `{element}` rule of the "
            f"same specificity sets them too: {where}"
        )

    if missing or bare or dangling or gaps or clipped or losers:
        if missing:
            print(
                f"\n{len(missing)} class(es) used in JSX that no stylesheet defines. "
                "Those elements render unstyled."
            )
        if bare:
            print(
                f"\n{len(bare)} button(s) carry only modifier classes. The rules are "
                "written as .button.primary and friends, so a button without "
                "`button` matches none of them."
            )
        if dangling:
            print(
                f"\n{len(dangling)} undeclared custom propert(ies). CSS discards the "
                "whole declaration when one is missing, so that property is simply "
                "absent rather than wrong."
            )
        if gaps:
            print(
                f"\n{len(gaps)} token(s) are defined in one theme but not the other. "
                "A token missing from light is discarded there; a token missing "
                "from dark keeps its light value."
            )
        if clipped:
            print(
                f"\n{len(clipped)} shell container(s) clip their overflow. A menu "
                "positioned inside one opens and paints nothing, which looks "
                "exactly like a feature that was never built."
            )
        if losers:
            print(
                f"\n{len(losers)} bare-control rule(s) lose to a generic control "
                "rule further down the sheet. Equal specificity is settled by "
                "order, so the field keeps the border and padding it was "
                "supposed to shed. Add a second class rather than moving the rule."
            )
        return 1

    print(
        f"Checked {len(used)} class(es), every button's base class and every "
        f"var(--token) across {len(sheets)} stylesheet(s); light and dark "
        "define the same tokens."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
