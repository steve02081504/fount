#!/usr/bin/env python3
"""Regenerate the locale-copy review worklists.

Three deterministic worklists feed the native-reviewer rounds documented in
`src/public/locales/docs/locale-edits.md`:

- `brand.md`   keys where zh-CN names the product `fount` but the locale never writes it
               (a translated product name — `fontur`, `fontein`, `Quelle`, `фонд` — which the
               `i18n_copy` brand rule cannot see, because that rule only knows `font` and its aliases)
- `markup.md`  markup the source carries and the locale dropped (`<br/>`, `<i>`, `<strong>`, links,
               backticked code spans); `emoji` is skipped, it speaks in symbols
- `drift.md`  identical source sentences rendered differently within one locale

Usage:
    python .esh/commands/locale_copy_worklists.py [--locales-dir DIR] [--out DIR] [locale ...]
    python .esh/commands/locale_copy_worklists.py --self-test
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_LOCALES = os.path.join(ROOT, 'src', 'public', 'locales')
DEFAULT_OUT = os.path.join(ROOT, 'data', 'locale_copy_review')

LINK = re.compile(r'\]\(([^)]+)\)')
CODE_SPAN = re.compile(r'`[^`]*`')
TAGS = ('i', 'strong', 'b', 'em', 'br')
# 原样照抄 zh-CN 会读起来很生硬的地方：这些键是刻意的整句改写，不是丢了标记
DELIBERATE_MARKUP = {
    ('en-UK', 'tutorial.progressMessages.keyboardPress'),
    ('en-UK', 'tutorial.progressMessages.mobileClick'),
    ('en-UK', 'tutorial.progressMessages.mobileTouchMove'),
    ('en-UK', 'tutorial.progressMessages.mouseMove'),
}
SKIP_MARKUP_LOCALES = {'zh-CN', 'emoji'}


def leaf_map(node, prefix=''):
    """Flatten a locale tree into (dotted key, string leaf) pairs in file order."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from leaf_map(value, f'{prefix}.{key}' if prefix else key)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from leaf_map(value, f'{prefix}[{index}]')
    elif isinstance(node, str):
        yield prefix, node


def load(locales_dir, name):
    with open(os.path.join(locales_dir, f'{name}.json'), encoding='utf-8') as handle:
        return dict(leaf_map(json.load(handle)))


def locale_names(locales_dir):
    return [name[:-5] for name in sorted(os.listdir(locales_dir)) if name.endswith('.json')]


def brand_rows(master, locale):
    rows = []
    for key, source in sorted(master.items()):
        if 'fount' not in source.lower():
            continue
        value = locale.get(key)
        if not isinstance(value, str) or 'fount' in value.lower():
            continue
        if re.search(r'[\u4e00-\u9fff]', value):
            continue
        rows.append((key, source, value))
    return rows


def markup_rows(master, name, locale):
    rows = []
    for key, value in sorted(locale.items()):
        source = master.get(key)
        if not isinstance(source, str) or (name, key) in DELIBERATE_MARKUP:
            continue
        notes = []
        for tag in TAGS:
            want = len(re.findall(rf'<{tag}\b', source))
            have = len(re.findall(rf'<{tag}\b', value))
            if have < want:
                notes.append(f'{tag}: source {want}, {name} {have}')
        if sorted(LINK.findall(source)) != sorted(LINK.findall(value)):
            notes.append(f'link target: source {LINK.findall(source)}, {name} {LINK.findall(value)}')
        if len(CODE_SPAN.findall(source)) > len(CODE_SPAN.findall(value)):
            notes.append(f'code span: source {len(CODE_SPAN.findall(source))}, {name} {len(CODE_SPAN.findall(value))}')
        if notes:
            rows.append((key, source, value, '; '.join(notes)))
    return rows


def drift_rows(master, name, locale):
    """One source sentence, several wordings inside this locale.

    A cluster where two keys render the same sentence differently may indicate
    drift; the reviewer still needs to account for the context of each key.
    """
    families = {}
    for key, source in master.items():
        if len(source) < 12 or source.strip() != source or not source:
            continue
        families.setdefault(source, []).append(key)
    rows = []
    for source, keys in families.items():
        if len(keys) < 2:
            continue
        values = {locale.get(key) for key in keys if isinstance(locale.get(key), str)}
        if len(values) > 1:
            rows.append((keys[0], source, sorted(values), keys))
    return sorted(rows)


HEADERS = {
    'brand': (
        'Product-name worklist',
        "The zh-CN source names the product (`fount`) in each row below, but this locale's value never writes it. "
        "Sometimes that is right (the sentence talks about *source files*, not the product). When the row really is "
        "about the product, put `fount` back — inflected per your language's grammar, never translated, never "
        "capitalised — and leave the rest of the sentence as it is. Rows that are fine: say so in your reply, do not "
        'patch them.',
    ),
    'markup': (
        'Markup parity worklist',
        'Restore the markup the source carries where it belongs in this language: `<br/>` for the line the source '
        'breaks, `<i>`/`<strong>` for the phrase the source emphasises, and backticks around a literal token or code '
        'span. Keep the prose unchanged otherwise.',
    ),
    'drift': (
        'Wording drift worklist',
        'The zh-CN source uses the same sentence for the keys below, but this locale renders it more than one way. '
        'Pick the wording that fits the file best and make the siblings agree — unless the difference is deliberate '
        '(a label in one place, a sentence in another); say which you chose in your reply.',
    ),
}


def write_worklist(out_dir, name, kind, rows, master):
    path = os.path.join(out_dir, name, f'{kind}.md')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    title, blurb = HEADERS[kind]
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(f'# {title} — {name}\n\n{blurb}\n\n')
        for row in rows:
            if kind == 'brand':
                key, source, value = row
                handle.write(f'## {key}\n   zh-CN: {source!r}\n   {name}: {value!r}\n')
            elif kind == 'markup':
                key, source, value, notes = row
                handle.write(f'## {key}\n   issue: {notes}\n   zh-CN: {source!r}\n   {name}: {value!r}\n')
            elif kind == 'drift':
                key, source, values, keys = row
                handle.write(f'## {key}  (+{len(keys) - 1} sibling{"s" if len(keys) > 2 else ""})\n   zh-CN: {source!r}\n')
                for candidate in values:
                    handle.write(f'   {name}: {candidate!r}\n')
                handle.write(f'   keys: {", ".join(keys)}\n')
    return path, len(rows)

def generate(locales_dir, out_dir, wanted):
    master = load(locales_dir, 'zh-CN')
    counts = {}
    for name in locale_names(locales_dir):
        if name == 'zh-CN' or (wanted and name not in wanted):
            continue
        locale = load(locales_dir, name)
        if name not in SKIP_MARKUP_LOCALES:
            path, count = write_worklist(out_dir, name, 'markup', markup_rows(master, name, locale), master)
            counts.setdefault('markup', {})[name] = count
            print(f'{name}: {count} markup rows -> {path}')
        path, count = write_worklist(out_dir, name, 'brand', brand_rows(master, locale), master)
        counts.setdefault('brand', {})[name] = count
        print(f'{name}: {count} brand rows -> {path}')
        path, count = write_worklist(out_dir, name, 'drift', drift_rows(master, name, locale), master)
        counts.setdefault('drift', {})[name] = count
        print(f'{name}: {count} drift rows -> {path}')
    return counts


def self_test():
    """Hermetic: a two-language fixture exercising every rule."""
    work = tempfile.mkdtemp(prefix='locale-worklists-')
    try:
        locales = os.path.join(work, 'locales')
        out = os.path.join(work, 'out')
        os.makedirs(locales)
        master = {
            'a.brand': '重启 fount 服务',
            'a.markup': '按住${key}<br/>再松开，见 `fount test`',
            'a.clean': '仅此而已',
        }
        with open(os.path.join(locales, 'zh-CN.json'), 'w', encoding='utf-8') as handle:
            json.dump(master, handle, ensure_ascii=False)
        with open(os.path.join(locales, 'xx-XX.json'), 'w', encoding='utf-8') as handle:
            json.dump({'a.brand': 'Restart the font service', 'a.markup': 'Hold ${key} on fount and release'},
                      handle, ensure_ascii=False)
        counts = generate(locales, out, set())
        with open(os.path.join(out, 'xx-XX', 'brand.md'), encoding='utf-8') as handle:
            brand = handle.read()
        with open(os.path.join(out, 'xx-XX', 'markup.md'), encoding='utf-8') as handle:
            markup = handle.read()
        checks = [
            (counts['brand']['xx-XX'] == 1 and '## a.brand' in brand and 'Restart the font service' in brand,
             'brand worklist lists the translated product name'),
            ('## a.markup' in markup and 'br: source 1, xx-XX 0' in markup and 'code span: source 1, xx-XX 0' in markup,
             'markup worklist lists the dropped br and code span'),
            ('## a.clean' not in markup and '## a.clean' not in brand, 'clean rows stay out of the worklists'),
        ]
        failed = [message for ok, message in checks if not ok]
        for ok, message in checks:
            print(f'{"ok" if ok else "FAILED"}  {message}')
        if failed:
            sys.exit(1)
        print('locale_copy_worklists self-test ok')
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('locales', nargs='*', help='locale ids to regenerate (default: all)')
    parser.add_argument('--locales-dir', default=DEFAULT_LOCALES)
    parser.add_argument('--out', default=DEFAULT_OUT)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    generate(args.locales_dir, args.out, set(args.locales))


if __name__ == '__main__':
    main()
