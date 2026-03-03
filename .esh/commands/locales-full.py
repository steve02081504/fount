"""
locales-full: 合并/回写 locales。可指定语言，不指定则处理全部。
  python locales-full.py              → 合并所有语言到 full_locales/<lang>.full.yaml（跳过无变更）
  python locales-full.py back         → 从 full_locales/*.full.yaml 回写所有语言（仅写有变更的文件）
  python locales-full.py zh-CN        → 仅合并 zh-CN
  python locales-full.py back zh-CN   → 仅回写 zh-CN
  python locales-full.py zh-CN en     → 仅合并 zh-CN 与 en
"""

import copy
import json
import re
import sys
import yaml
from pathlib import Path

_LANG_KEY_RE = re.compile(r"^[a-z]{2}(-[A-Z]{2})?$")
_CODE_FENCE_RE = re.compile(r"^(`{3,}|~{3,})")
_INDENT = 2

FOUNT_DIR = Path.cwd()
MAIN_LOCALES_DIR = FOUNT_DIR / "src" / "public" / "locales"
FULL_LOCALES_DIR = FOUNT_DIR / "full_locales"
DOCS_DIR = FOUNT_DIR / "docs"
LOCALES_FILENAME = "locales.json"
IGNORE_DIRS = {"node_modules", ".git", "dist", "build"}
LANG_LIKE_KEYS = {"emoji", "lzh"}
SKIP_KEYS = {"_docs_readme"}


def _str_representer(dumper, data):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


yaml.representer.SafeRepresenter.add_representer(str, _str_representer)
yaml.representer.Representer.add_representer(str, _str_representer)


def _is_lang_like_key(k: str) -> bool:
    return bool(_LANG_KEY_RE.match(k)) or k in LANG_LIKE_KEYS


def _is_lang_block(data: dict) -> bool:
    return bool(data) and all(_is_lang_like_key(k) for k in data)


def find_part_locales_json(root: Path) -> list[str]:
    return [
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob(LOCALES_FILENAME)
        if not any(part in IGNORE_DIRS for part in p.parts)
    ]


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _yaml_str(obj) -> str:
    return yaml.dump(obj, allow_unicode=True, default_flow_style=False, sort_keys=False, indent=_INDENT, width=1000)


def _json_str(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent="\t") + "\n"


def _readme_to_yaml(text: str) -> str:
    """Markdown → YAML 存储：代码块外的软换行（行尾 2+ 空格）转为 \\ 尾，使 | 块样式可用。"""
    in_code, out = False, []
    for line in text.rstrip("\n").splitlines():
        if _CODE_FENCE_RE.match(line):
            in_code = not in_code
        if in_code:
            out.append(line)
        elif len(line) - len(line.rstrip()) >= 2:
            out.append(line.rstrip() + "\\")
        else:
            out.append(line.rstrip())
    return "\n".join(out)


def _readme_from_yaml(text: str) -> str:
    """YAML 存储 → Markdown：代码块外的 \\ 尾还原为软换行（行尾 2 空格）。"""
    in_code, out = False, []
    for line in text.splitlines():
        if _CODE_FENCE_RE.match(line):
            in_code = not in_code
        if not in_code and line.endswith("\\"):
            out.append(line[:-1] + "  ")
        else:
            out.append(line)
    return "\n".join(out) + "\n"


def write_if_changed(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raw = path.read_bytes()
        if b"\r\n" in raw or raw.endswith(b"\r"):
            # 存在 CRLF 或尾随 \r，需要写回以统一为 LF
            pass
        elif raw.decode("utf-8") == content:
            return False
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return True


def extract_lang_from_part_data(data, lang: str):
    if not isinstance(data, dict):
        return data
    # 语言块：所有 key 均为语言代码。只提取目标语言，无则返回 None
    if _is_lang_block(data):
        return extract_lang_from_part_data(data[lang], lang) if lang in data else None
    out = {k: v for k, v in ((k, extract_lang_from_part_data(v, lang)) for k, v in data.items()) if v is not None}
    return out or None


def merge_lang_into_part_data(current: dict, extracted, lang: str) -> bool:
    if not isinstance(extracted, dict):
        current[lang] = extracted
        return True
    if _is_lang_block(current):
        current[lang] = extracted
        return True
    changed = False
    for k, v in extracted.items():
        if not isinstance(current.get(k), dict):
            current[k] = {}
        if merge_lang_into_part_data(current[k], v, lang):
            changed = True
    return changed


def merge_cmd(lang: str, out_path: Path) -> None:
    main_rel = f"src/public/locales/{lang}.json"
    main_path = FOUNT_DIR / main_rel

    full = {}
    readme_path = DOCS_DIR / f"Readme.{lang}.md"
    if readme_path.exists():
        full["_docs_readme"] = _readme_to_yaml(readme_path.read_text(encoding="utf-8"))
    if main_path.exists():
        full[main_rel] = load_json(main_path)

    for rel in find_part_locales_json(FOUNT_DIR):
        extracted = extract_lang_from_part_data(load_json(FOUNT_DIR / rel), lang)
        if extracted:
            full[rel] = extracted

    ordered = dict(sorted(full.items(), key=lambda x: (x[0] != "_docs_readme", x[0] != main_rel, x[0])))

    if write_if_changed(out_path, _yaml_str(ordered)):
        part_count = sum(1 for k in full if k not in (main_rel, "_docs_readme"))
        print(f"Merged: {lang} -> {out_path}  (main: {'+' if main_rel in full else '-'}, readme: {'+' if '_docs_readme' in full else '-'}, parts: {part_count})")
    else:
        print(f"Skip (unchanged): {lang}")


def back_cmd(lang: str, in_path: Path) -> None:
    full = yaml.safe_load(in_path.read_text(encoding="utf-8"))
    main_rel = f"src/public/locales/{lang}.json"
    wrote = 0

    if "_docs_readme" in full:
        readme_path = DOCS_DIR / f"Readme.{lang}.md"
        if write_if_changed(readme_path, _readme_from_yaml(full["_docs_readme"])):
            print(f"Wrote readme: {readme_path.name}")
            wrote += 1

    if main_rel in full:
        if write_if_changed(FOUNT_DIR / main_rel, _json_str(full[main_rel])):
            print(f"Wrote main: {main_rel}")
            wrote += 1

    for key, value in full.items():
        if key in SKIP_KEYS or key == main_rel:
            continue
        abs_path = FOUNT_DIR / key
        if not abs_path.exists():
            print(f"Skip (missing): {key}")
            continue
        merged = copy.deepcopy(load_json(abs_path))
        merge_lang_into_part_data(merged, value, lang)
        if write_if_changed(abs_path, _json_str(merged)):
            print(f"Wrote part: {key}")
            wrote += 1

    print(f"Back done: {lang} ({'no changes' if not wrote else f'{wrote} files'})")


def discover_langs() -> list[str]:
    return [p.stem for p in MAIN_LOCALES_DIR.glob("*.json")] if MAIN_LOCALES_DIR.exists() else []


def main():
    argv = sys.argv[1:]
    cmd = argv[0] if argv else ""
    if cmd == "back":
        langs_arg = argv[1:]  # back 之后的均为语言
    else:
        langs_arg = argv if argv else []  # 无 back 则全部为语言（空=全部）

    FULL_LOCALES_DIR.mkdir(parents=True, exist_ok=True)
    all_langs = discover_langs()

    if cmd == "back":
        if not langs_arg:
            candidates = sorted(FULL_LOCALES_DIR.glob("*.full.yaml"))
        else:
            candidates = [FULL_LOCALES_DIR / f"{lang}.full.yaml" for lang in langs_arg]
        for p in candidates:
            if not p.exists():
                print(f"Skip (missing): {p.name}")
                continue
            lang = p.stem.removesuffix(".full")
            if lang:
                back_cmd(lang, p)
    else:
        langs = langs_arg if langs_arg else all_langs
        for lang in langs:
            if lang not in all_langs:
                print(f"Skip (unknown lang): {lang}")
                continue
            merge_cmd(lang, FULL_LOCALES_DIR / f"{lang}.full.yaml")


if __name__ == "__main__":
    main()
