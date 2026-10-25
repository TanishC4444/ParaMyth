"""Lint user-facing website copy (buttons, page intros, hints, toasts, errors).

Applies the humanizer patterns that matter for product UI text, tuned for the
site voice in .claude/skills/site-copy/SKILL.md. Story prose is out of scope:
mark story or model-prompt text with `copy-lint: off` / `copy-lint: on`, or
`copy-lint: ignore` for a single line.

    python -m scripts.copy_lint                 # default site files
    python -m scripts.copy_lint web/teams.html  # specific files or folders
    python -m scripts.copy_lint --text "Click here to seamlessly submit!"
    python -m scripts.copy_lint --dump frontend-pipeline/src/views/Runs.tsx
"""
import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ['frontend-pipeline/src', 'frontend-pipeline/index.html', 'web', 'paramyth/pipeline/production_ui.html', 'paramyth/pipeline/image_ui.html']
SUFFIXES = {'.ts', '.tsx', '.js', '.html'}

# (id, severity, pattern, fix). Errors fail --strict and the test suite; warnings are judgment calls.
RULES = [
    ('em-dash', 'error', r'—', 'Drop the em dash: use a comma, colon, period or " · ".'),
    ('importance-formula', 'error', r"(?i)\b(it'?s|it is) (important|worth noting|crucial) to\b|\b(keep|bear) in mind that\b|\bplease note\b",
     'Say the thing or the action instead of announcing that it matters.'),
    ('hedge-stack', 'error', r'(?i)\bit is possible that\b|\b(may|might|could)\b(?:\W+\w+){0,6}\W+(may|might|could)\b|\b(potentially|possibly)\b(?:\W+\w+){0,4}\W+(may|might|could)\b',
     'Keep one hedge at most, or commit to the claim.'),
    ('ai-vocab', 'error', r'(?i)\b(delv(e|es|ed|ing)|intricate|intricacies|realm|underscor(e|es|ed|ing)|showcas(e|es|ed|ing)|tapestry|testament|multifaceted|meticulous(ly)?|paramount|pivotal|crucial|robust|comprehensive|groundbreaking|embark|unlock|elevate|empower(s|ing)?|harness)\b',
     'Swap the AI-flavored word for a plain one (look at, shows, full, reliable, use).'),
    ('hype', 'error', r'(?i)\b(seamless(ly)?|cutting[- ]edge|game[- ]?changer|revolutioni[sz]e|supercharge|next[- ]level|world[- ]class|best[- ]in[- ]class|effortless(ly)?|unleash|magical|blazing(ly)? fast)\b',
     'Cut the marketing claim; say what the feature actually does.'),
    ('chatbot', 'error', r"(?i)\b(oops|whoops|uh[- ]oh|great (news|question)|we're (so )?excited|i hope this helps|happy to help|sorry for the inconvenience)\b",
     'Drop the scripted reaction and get to the information.'),
    ('too-casual', 'error', r"(?i)\b(gonna|wanna|gotta|lol|yay|woo+hoo|y'all|awesome sauce|super easy|no worries)\b",
     'Too casual for the site voice; aim for a friendly coworker, not a group chat.'),
    ('click-here', 'error', r'(?i)\bclick here\b', 'Name the destination or action in the link text.'),
    ('emoji', 'error', '[\U0001F300-\U0001FAFF✅❌✨]', 'No emoji in interface copy.'),
    ('filler', 'warn', r'(?i)\b(simply|easily|kindly|in order to|at this time|due to the fact|successfully|utili[sz]e|leverage)\b',
     'Filler word; the sentence reads the same without it.'),
    ('stiff', 'warn', r'\b(?i:henceforth|aforementioned|please be advised|facilitate|functionality|an error has occurred|invalid input|end[- ]user)\b|^(Submit|Proceed|OK)$',
     'Reads like a form letter; use the plain verb or name the result.'),
    ('jargon', 'warn', r'(?i)\b(deterministic|append-only|idempotent|bounded|provenance|instantiate|payload|prose hash)\b',
     'Internal term; say what it means for the person using the page.'),
    ('exclamation', 'warn', r'(?<=\w)!(?=\s|$)', 'Skip the exclamation mark; the site voice stays calm.'),
]
COMPILED = [(rid, sev, re.compile(pat), fix) for rid, sev, pat, fix in RULES]
SKIP_EXACT = {'—', '!', '–'}


def check(text):
    """Return [(rule_id, severity, match, fix)] for one piece of copy."""
    text = ' '.join(re.sub(r'<[^>]+>', ' ', text).split())
    # Lowercase single tokens are identifiers, class names or event names, not copy.
    if not re.search(r'[A-Za-z]', text) or text in SKIP_EXACT or re.fullmatch(r'[a-z0-9_\-./:#@]+', text):
        return []
    return [(rid, sev, m.group(0), fix) for rid, sev, rx, fix in COMPILED for m in rx.finditer(text)]


def _silenced(lines):
    """Line numbers (1-based) excluded by copy-lint markers."""
    off, quiet = False, set()
    for n, line in enumerate(lines, 1):
        if 'copy-lint: off' in line: off = True
        if off or 'copy-lint: ignore' in line: quiet.add(n)
        if 'copy-lint: on' in line: off = False
    return quiet


def scan_script(src):
    """Yield (line, text) for string literals and JSX text in TS/JS source."""
    i, n, line, code_prev = 0, len(src), 1, ''
    stack = []  # [brace depth, start line, text so far] for each open template substitution

    def read_quoted(q):
        nonlocal i, line
        start, buf = line, []
        i += 1
        while i < n and src[i] != q and src[i] != '\n':
            if src[i] == '\\': buf.append(src[i:i + 2]); i += 2; continue
            buf.append(src[i]); i += 1
        i += 1
        return start, ''.join(buf)

    def read_template(start, buf):
        """Read template text to the closing backtick, or pause at ${ (placeholders read as {x})."""
        nonlocal i, line
        while i < n:
            c = src[i]
            if c == '\\': buf += src[i:i + 2]; i += 2; continue
            if c == '`': i += 1; return start, buf
            if c == '$' and src[i + 1:i + 2] == '{': i += 2; stack.append([0, start, buf + '{x}']); return None
            if c == '\n': line += 1
            buf += c; i += 1
        return start, buf

    while i < n:
        c = src[i]
        if c == '\n': line += 1; i += 1; continue
        if src.startswith('//', i): i = src.find('\n', i) if '\n' in src[i:] else n; continue
        if src.startswith('/*', i):
            end = src.find('*/', i + 2); end = n if end < 0 else end + 2
            line += src.count('\n', i, end); i = end; continue
        if c in '"\'':
            yield read_quoted(c); code_prev = 'x'; continue
        if c == '`':
            i += 1; done = read_template(line, '')
            if done: yield done
            code_prev = 'x'; continue
        if c == '/' and code_prev in '(,=:[!&|?{};+' :  # regex literal
            i += 1
            in_class = False
            while i < n and src[i] != '\n' and (src[i] != '/' or in_class):
                if src[i] == '\\': i += 2; continue
                if src[i] == '[': in_class = True
                elif src[i] == ']': in_class = False
                i += 1
            i += 1; code_prev = 'x'; continue
        if stack and c == '{': stack[-1][0] += 1
        if stack and c == '}':
            if stack[-1][0] == 0:
                _, start, buf = stack.pop(); i += 1; done = read_template(start, buf)
                if done: yield done
                code_prev = 'x'; continue
            stack[-1][0] -= 1
        if c == '>' and src[i - 1:i] not in ('=', '-', '>') and src[i + 1:i + 2] not in ('=', '>'):
            # JSX text runs to the next tag or expression; apostrophes in it are not string quotes.
            m = re.match(r'>([^<{}"`=&|;()\[\]]*)(?=[<{])', src[i:])
            if m and len(re.findall(r'[A-Za-z]', m.group(1))) >= 2:
                yield line, m.group(1)
                line += m.group(1).count('\n'); i += len(m.group(0)); code_prev = '>'; continue
        if not c.isspace(): code_prev = c
        i += 1


class _HTMLCopy(HTMLParser):
    ATTRS = {'placeholder', 'title', 'aria-label', 'alt', 'label'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'svg'): self.skip += 1
        a = dict(attrs)
        texts = [v for k, v in attrs if k in self.ATTRS and v]
        if tag == 'meta' and a.get('name') == 'description' and a.get('content'): texts.append(a['content'])
        self.found += [(self.getpos()[0], t) for t in texts]

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'svg') and self.skip: self.skip -= 1

    def handle_data(self, data):
        if not self.skip and data.strip(): self.found.append((self.getpos()[0], data))


def extract(path):
    """[(line, text)] of user-facing copy in one file, minus silenced lines."""
    src = path.read_text(encoding='utf-8')
    if path.suffix == '.html':
        parser = _HTMLCopy(); parser.feed(src); found = parser.found
        # Inline module scripts carry copy too.
        for m in re.finditer(r'<script[^>]*>(.*?)</script>', src, re.S):
            base = src.count('\n', 0, m.start(1))
            found += [(base + ln, t) for ln, t in scan_script(m.group(1))]
    else:
        found = list(scan_script(src))
    quiet = _silenced(src.splitlines())
    return [(ln, ' '.join(t.split())) for ln, t in found if ln not in quiet and t.strip()]


def files(targets):
    for t in targets:
        p = (ROOT / t) if not Path(t).is_absolute() else Path(t)
        if p.is_dir():
            yield from sorted(f for f in p.rglob('*') if f.suffix in SUFFIXES and 'node_modules' not in f.parts and 'dist' not in f.parts)
        elif p.suffix in SUFFIXES:
            yield p


def lint(targets=TARGETS):
    """[(path, line, rule_id, severity, match, text, fix)] across the targets."""
    out = []
    for f in files(targets):
        rel = f.relative_to(ROOT) if f.is_relative_to(ROOT) else f
        for ln, text in extract(f):
            out += [(str(rel), ln, rid, sev, hit, text, fix) for rid, sev, hit, fix in check(text)]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('paths', nargs='*', help='files or folders (default: site sources)')
    ap.add_argument('--text', help='check one piece of copy instead of files')
    ap.add_argument('--dump', action='store_true', help='print every extracted string instead of linting')
    ap.add_argument('--strict', action='store_true', help='exit 1 on warnings too')
    a = ap.parse_args(argv)
    if a.text is not None:
        hits = check(a.text)
        for rid, sev, hit, fix in hits: print(f'{sev} [{rid}] "{hit}": {fix}')
        print('clean' if not hits else f'{len(hits)} issue(s)')
        return int(any(sev == 'error' or a.strict for _, sev, _, _ in hits))
    targets = a.paths or TARGETS
    if a.dump:
        for f in files(targets):
            for ln, text in extract(f): print(f'{f.relative_to(ROOT) if f.is_relative_to(ROOT) else f}:{ln}: {text}')
        return 0
    hits = lint(targets)
    for path, ln, rid, sev, hit, text, fix in hits:
        print(f'{path}:{ln}: {sev} [{rid}] "{hit}" in "{text[:90]}"\n    {fix}')
    errors = sum(h[3] == 'error' for h in hits)
    print(f'{errors} error(s), {len(hits) - errors} warning(s)')
    return int(errors > 0 or (a.strict and bool(hits)))


if __name__ == '__main__':
    sys.exit(main())
