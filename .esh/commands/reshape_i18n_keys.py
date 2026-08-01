#!/usr/bin/env python3
"""
对全部 locale JSON 跑前缀嵌套，写出 old→new 映射，并改写仓库内引号中的 i18n 键。

用法（在仓库根）:
  python .esh/commands/reshape_i18n_keys.py
  python .esh/commands/reshape_i18n_keys.py path/to/extra_renames.json
  python .esh/commands/reshape_i18n_keys.py --self-test

extra_renames.json 为一次性语义改名表 { "old.path": "new.path", ... }（临时文件，不进仓库）。
省略则只做前缀嵌套 + 引用改写。

locale JSON 必须用 Python 读写：JS JSON.stringify 会把纯数字键（如 "404"）排到对象最前。
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import OrderedDict

try:
	import pathspec
except ImportError:
	pathspec = None

MY_DIR = os.path.dirname(os.path.abspath(__file__))
FOUNT_DIR = os.path.abspath(os.path.join(MY_DIR, "../.."))
LOCALES_DIR = os.path.join(FOUNT_DIR, "src", "public", "locales")
MAP_PATH = os.path.join(FOUNT_DIR, "data", "test", "i18n_key_rename_map.json")
EXCLUDE_PREFIXES_PATH = os.path.join(FOUNT_DIR, "src", "scripts", "checks", "i18n_rewrite_exclude_prefixes.json")

_MISSING = object()

PLURAL_CONTAINER = {"tab": "tabs"}
PREFIX_CLUSTER_MIN = 4

I18N_REWRITE_SUFFIXES = (".mjs", ".js", ".ts", ".html", ".ps1", ".sh", ".py")
AFFIX_RE = re.compile(r"^(?:Suffix|Prefix)|(?:Suffix|Prefix)$")
NUMBERED_RE = re.compile(r"^[A-Za-z][A-Za-z]*\d+$")
SCREAMING_SNAKE_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
UPDATE_LOCALE_DATA_HINT = "搬键请用 `.esh/commands/update_locale_data.py`（get → set(new) → set(old, None)），勿手改各语言 JSON。详见 src/public/locales/locale-edits.md。"
AFFIX_HINT = "应用 `${param}` 格式化完整句子，不要用 Suffix/Prefix 碎片硬拼字符串。"


def loads_locale(text: str):
	return json.loads(text, object_pairs_hook=OrderedDict)


def dumps_locale(data) -> str:
	return json.dumps(data, ensure_ascii=False, indent="\t") + "\n"


def is_screaming_snake_key(key: str) -> bool:
	return bool(SCREAMING_SNAKE_RE.match(key))


def camel_prefixes(key: str) -> list[str]:
	# SEND_MESSAGES 等常量键不当驼峰簇成员，避免嵌成 sEND_MESSAGES / mANAGE_.cHANNELS
	if is_screaming_snake_key(key):
		return []
	prefixes = []
	for index in range(1, len(key)):
		if key[index].isupper():
			prefixes.append(key[:index])
	return prefixes


def decapitalize(remainder: str) -> str:
	if not remainder:
		return remainder
	# 后缀本身是 SCREAMING_SNAKE 时保持原样（perm + SEND_MESSAGES → SEND_MESSAGES）
	if is_screaming_snake_key(remainder):
		return remainder
	return remainder[0].lower() + remainder[1:]


def container_key_for_prefix(prefix: str) -> str:
	return PLURAL_CONTAINER.get(prefix, prefix)


def find_prefix_clusters(keys: list[str], minimum: int = PREFIX_CLUSTER_MIN) -> list[dict]:
	by_prefix: dict[str, list[str]] = {}
	for key in keys:
		for prefix in camel_prefixes(key):
			rest = key[len(prefix) :]
			if not rest or not rest[0].isupper():
				continue
			by_prefix.setdefault(prefix, []).append(key)
	clusters = [{"prefix": prefix, "members": sorted(members)} for prefix, members in by_prefix.items() if len(members) >= minimum]
	clusters.sort(key=lambda c: (-len(c["prefix"]), -len(c["members"]), c["prefix"]))
	return clusters


def can_use_container(obj: OrderedDict, prefix: str, members: list[str], container_name: str) -> bool:
	bucket: OrderedDict = OrderedDict()
	existing = obj.get(container_name, _MISSING)
	if existing is not _MISSING and isinstance(existing, dict):
		bucket.update(existing)
	elif existing is not _MISSING and container_name not in members:
		bucket["main"] = existing
	for key in members:
		child = decapitalize(key[len(prefix) :])
		if child in bucket and bucket[child] is not obj[key]:
			return False
	return True


def pick_container_name(obj: OrderedDict, prefix: str, members: list[str], preferred: str) -> str:
	candidates = [preferred, f"{preferred}Items", f"{prefix}Items"]
	seen = set()
	for name in candidates:
		if name in seen:
			continue
		seen.add(name)
		if can_use_container(obj, prefix, members, name):
			return name
	raise RuntimeError(f"无法为前缀「{prefix}」找到无冲突的容器键（尝试了 {', '.join(candidates)}）")


def apply_prefix_nest(obj: OrderedDict, prefix: str, members: list[str], preferred: str, on_move=None) -> str:
	container_name = pick_container_name(obj, prefix, members, preferred)
	bucket: OrderedDict = OrderedDict()
	existing = obj.get(container_name, _MISSING)
	if existing is not _MISSING and isinstance(existing, dict):
		bucket.update(existing)
	elif existing is not _MISSING and container_name not in members:
		bucket["main"] = existing
		if on_move:
			on_move(container_name, f"{container_name}.main")
		del obj[container_name]

	for key in members:
		child = decapitalize(key[len(prefix) :])
		bucket[child] = obj[key]
		if on_move:
			on_move(key, f"{container_name}.{child}")
		del obj[key]
	obj[container_name] = bucket
	return container_name


def map_put(path_map: dict[str, str], from_path: str, to_path: str) -> None:
	path_map[from_path] = to_path
	for key, value in path_map.items():
		if key == from_path:
			continue
		if value == from_path or value.startswith(f"{from_path}."):
			path_map[key] = to_path + value[len(from_path) :]


def nest_all_prefix_clusters_with_map(obj: OrderedDict, path: str = "", path_map: dict | None = None) -> int:
	if path_map is None:
		path_map = {}
	count = 0
	while True:
		clusters = find_prefix_clusters(list(obj.keys()))
		if not clusters:
			break
		cluster = clusters[0]
		prefix = cluster["prefix"]
		members = cluster["members"]
		preferred = container_key_for_prefix(prefix)

		def on_move(old_key, new_rel, _path=path, _map=path_map):
			old_path = f"{_path}.{old_key}" if _path else old_key
			new_path = f"{_path}.{new_rel}" if _path else new_rel
			map_put(_map, old_path, new_path)

		apply_prefix_nest(obj, prefix, members, preferred, on_move)
		count += 1

	for key, value in list(obj.items()):
		if isinstance(value, dict):
			child_path = f"{path}.{key}" if path else key
			count += nest_all_prefix_clusters_with_map(value, child_path, path_map)
	return count


def scan_i18n_key_structure(data, path: str = "") -> list[dict]:
	if not isinstance(data, dict):
		return []
	issues = []
	keys = list(data.keys())
	for key in keys:
		full = f"{path}.{key}" if path else key
		if AFFIX_RE.search(key):
			issues.append(
				{
					"kind": "affix",
					"path": full,
					"message": f"键名「{key}」以 Suffix/Prefix 开头或结尾。{AFFIX_HINT} {UPDATE_LOCALE_DATA_HINT}",
				}
			)
		if NUMBERED_RE.match(key):
			issues.append(
				{
					"kind": "numbered",
					"path": full,
					"message": f"键名「{key}」以编号结尾；请用有意义的名字，如需枚举请用数组。{UPDATE_LOCALE_DATA_HINT}",
				}
			)
	for cluster in find_prefix_clusters(keys):
		prefix = cluster["prefix"]
		members = cluster["members"]
		container = container_key_for_prefix(prefix)
		parent_label = path or "(root)"
		nested = ", ".join(decapitalize(m[len(prefix) :]) for m in members)
		issues.append(
			{
				"kind": "prefix_cluster",
				"path": parent_label,
				"message": (f"{parent_label} 下有 {len(members)} 个键共享前缀「{prefix}」（{', '.join(members)}）。请嵌套为 {container}: {{ {nested} }}。{UPDATE_LOCALE_DATA_HINT}"),
			}
		)
	for key, value in data.items():
		if isinstance(value, dict):
			full = f"{path}.{key}" if path else key
			issues.extend(scan_i18n_key_structure(value, full))
	return issues


def combine_maps(auto_map: dict[str, str], extra_manual: dict[str, str]) -> dict[str, str]:
	path_map = dict(auto_map)
	for from_path, to_path in extra_manual.items():
		map_put(path_map, from_path, to_path)
	return path_map


def reconcile_extra_through_nest(path_map: dict[str, str], extra_manual: dict[str, str]) -> None:
	for from_path, to_path in extra_manual.items():
		cur = to_path
		while cur in path_map and path_map[cur] != cur:
			nxt = path_map[cur]
			if not nxt or nxt == cur:
				break
			cur = nxt
			if cur == from_path:
				break
		if cur != to_path:
			map_put(path_map, from_path, cur)


def get_at(obj, path: str):
	cur = obj
	for part in path.split("."):
		if not isinstance(cur, dict) or part not in cur:
			return _MISSING
		cur = cur[part]
	return cur


def delete_at(obj, path: str) -> None:
	parts = path.split(".")
	parent = obj
	for part in parts[:-1]:
		if not isinstance(parent, dict) or part not in parent:
			return
		parent = parent[part]
	if isinstance(parent, dict):
		parent.pop(parts[-1], None)


def set_at(obj, path: str, value) -> None:
	parts = path.split(".")
	cur = obj
	for i, part in enumerate(parts[:-1]):
		if not isinstance(cur, dict):
			raise TypeError(f"Cannot set {path!r}: {'.'.join(parts[:i])!r} is not a dict")
		nxt = cur.get(part, _MISSING)
		if nxt is _MISSING:
			nxt = OrderedDict()
			cur[part] = nxt
		elif not isinstance(nxt, dict):
			raise TypeError(f"Cannot set {path!r}: {'.'.join(parts[: i + 1])!r} is not a dict")
		cur = nxt
	if not isinstance(cur, dict):
		raise TypeError(f"Cannot set {path!r}: parent is not a dict")
	cur[parts[-1]] = value


def _validate_path_map_targets(targets: list[str]) -> None:
	for i, a in enumerate(targets):
		for b in targets[i + 1 :]:
			if a == b or a.startswith(f"{b}.") or b.startswith(f"{a}."):
				raise ValueError(f"Conflicting path map targets: {a!r} and {b!r}")


def apply_path_map(data, path_map: dict[str, str]) -> None:
	planned = []
	for from_path, to_path in path_map.items():
		if from_path == to_path:
			continue
		value = get_at(data, from_path)
		if value is _MISSING:
			continue
		planned.append((from_path, to_path, value))
	_validate_path_map_targets([to_path for _from_path, to_path, _value in planned])
	for from_path, _to_path, _value in sorted(planned, key=lambda item: -item[0].count(".")):
		delete_at(data, from_path)
	for _from_path, to_path, value in sorted(planned, key=lambda item: item[1].count(".")):
		set_at(data, to_path, value)


def rewrite_quoted_keys(text: str, path_map: dict[str, str]) -> tuple[str, int]:
	entries = sorted(path_map.items(), key=lambda item: len(item[0]), reverse=True)
	hits = 0
	out = text
	for from_path, to_path in entries:
		if from_path == to_path:
			continue
		allow_prefix = not to_path.startswith(f"{from_path}.")
		for quote in ("'", '"', "`"):
			exact = f"{quote}{from_path}{quote}"
			exact_repl = f"{quote}{to_path}{quote}"
			if exact in out:
				parts = out.split(exact)
				hits += len(parts) - 1
				out = exact_repl.join(parts)
			if not allow_prefix:
				continue
			prefix = f"{quote}{from_path}."
			prefix_repl = f"{quote}{to_path}."
			if prefix in out:
				parts = out.split(prefix)
				hits += len(parts) - 1
				out = prefix_repl.join(parts)
	return out, hits


FOUNT_CONSOLE_PATH_PREFIX = "fountConsole.path."


def fount_console_path_relative_map(path_map: dict[str, str]) -> dict[str, str]:
	"""CLI Get-I18n / get_i18n keys are relative to fountConsole.path — strip that prefix for rewrite."""
	relative: dict[str, str] = {}
	for from_path, to_path in path_map.items():
		if from_path.startswith(FOUNT_CONSOLE_PATH_PREFIX) and to_path.startswith(FOUNT_CONSOLE_PATH_PREFIX):
			relative[from_path[len(FOUNT_CONSOLE_PATH_PREFIX) :]] = to_path[len(FOUNT_CONSOLE_PATH_PREFIX) :]
	return relative


def rewrite_source_file(rel: str, text: str, path_map: dict[str, str]) -> tuple[str, int]:
	out, hits = rewrite_quoted_keys(text, path_map)
	if rel.replace("\\", "/") in ("path/fount.ps1", "path/fount.sh"):
		rel_map = fount_console_path_relative_map(path_map)
		if rel_map:
			out2, hits2 = rewrite_quoted_keys(out, rel_map)
			return out2, hits + hits2
	return out, hits


def load_extra_manual(arg: str | None) -> dict[str, str]:
	if not arg:
		return {}
	abs_path = arg if os.path.isabs(arg) else os.path.abspath(arg)
	with open(abs_path, "r", encoding="utf-8") as handle:
		return json.load(handle)


def load_gitignore_spec():
	gitignore_path = os.path.join(FOUNT_DIR, ".gitignore")
	if pathspec is None or not os.path.exists(gitignore_path):
		return None
	with open(gitignore_path, "r", encoding="utf-8") as handle:
		return pathspec.PathSpec.from_lines("gitwildmatch", handle)


def load_exclude_prefixes() -> list[str]:
	with open(EXCLUDE_PREFIXES_PATH, "r", encoding="utf-8") as handle:
		return json.load(handle)


def is_i18n_rewrite_excluded(rel: str, prefixes: list[str] | None = None) -> bool:
	if prefixes is None:
		prefixes = load_exclude_prefixes()
	slash_prefixed = f"/{rel}"
	return any(rel.startswith(prefix) or f"/{prefix}" in slash_prefixed for prefix in prefixes)


def iter_source_files(gitignore_spec, exclude_prefixes: list[str]):
	for root, dirnames, filenames in os.walk(FOUNT_DIR):
		rel_root = os.path.relpath(root, FOUNT_DIR).replace("\\", "/")
		if rel_root == ".":
			rel_root = ""
		# prune ignored dirs
		kept = []
		for dirname in dirnames:
			rel_dir = f"{rel_root}/{dirname}".lstrip("/") + "/"
			if dirname == ".git":
				continue
			if gitignore_spec and gitignore_spec.match_file(rel_dir):
				continue
			kept.append(dirname)
		dirnames[:] = kept
		for filename in filenames:
			rel = f"{rel_root}/{filename}".lstrip("/").replace("\\", "/")
			if gitignore_spec and gitignore_spec.match_file(rel):
				continue
			if not any(rel.endswith(suffix) for suffix in I18N_REWRITE_SUFFIXES):
				continue
			if is_i18n_rewrite_excluded(rel, exclude_prefixes):
				continue
			yield rel


def self_test() -> int:
	"""CLI smoke: SCREAMING_SNAKE remainders + fountConsole.path relative rewrite."""
	obj = loads_locale(
		json.dumps(
			{
				"permSEND_MESSAGES": "send",
				"permVIEW_CHANNEL": "view",
				"permADD_REACTIONS": "react",
				"permUPLOAD_FILES": "upload",
				"permMANAGE_CHANNELS": "channels",
			},
			ensure_ascii=False,
		)
	)
	nest_all_prefix_clusters_with_map(obj)
	if set(obj.get("perm", {})) != {
		"SEND_MESSAGES",
		"VIEW_CHANNEL",
		"ADD_REACTIONS",
		"UPLOAD_FILES",
		"MANAGE_CHANNELS",
	}:
		print(f"perm keys unexpected: {list(obj.get('perm', {}))!r}", file=sys.stderr)
		return 1
	if loads_locale(dumps_locale(obj))["perm"]["SEND_MESSAGES"] != "send":
		print("dumps/loads corrupted SEND_MESSAGES", file=sys.stderr)
		return 1

	# Relative Get-I18n keys (strip fountConsole.path.) — nest coverage lives in Deno i18n_keys tests
	cli_map = {
		"fountConsole.path.remove.removingFount": "fountConsole.path.remove.removing.fount.main",
		"fountConsole.path.remove.removingFountFromPath": "fountConsole.path.remove.removing.fount.fromPath",
	}
	for label, path, source in (
		("CLI", "path/fount.ps1", "Get-I18n -key 'remove.removingFount'\nget_i18n 'remove.removingFountFromPath'\n"),
		("Shell", "path/fount.sh", "get_i18n 'remove.removingFount'\nget_i18n 'remove.removingFountFromPath'\n"),
	):
		out, hits = rewrite_source_file(path, source, cli_map)
		if hits < 2 or "'remove.removing.fount.main'" not in out or "'remove.removing.fount.fromPath'" not in out:
			print(f"{label} relative rewrite failed: hits={hits} out={out!r}", file=sys.stderr)
			return 1

	print(json.dumps({"ok": True, "perm": sorted(obj["perm"])}))
	return 0


def main() -> int:
	extra_manual = load_extra_manual(sys.argv[1] if len(sys.argv) > 1 else None)
	locale_files = sorted(name for name in os.listdir(LOCALES_DIR) if name.endswith(".json"))

	zh_path = os.path.join(LOCALES_DIR, "zh-CN.json")
	with open(zh_path, "r", encoding="utf-8") as handle:
		zh_original = loads_locale(handle.read())

	zh_nested = loads_locale(dumps_locale(zh_original))
	auto_map: dict[str, str] = {}
	nest_all_prefix_clusters_with_map(zh_nested, "", auto_map)

	leftover = scan_i18n_key_structure(zh_nested)
	if leftover:
		print("zh-CN still has issues after nest:", file=sys.stderr)
		for issue in leftover:
			print(f"  [{issue['kind']}] {issue['path']}: {issue['message']}", file=sys.stderr)
		return 1

	path_map = combine_maps(auto_map, extra_manual)
	reconcile_extra_through_nest(path_map, extra_manual)

	for file_name in locale_files:
		abs_path = os.path.join(LOCALES_DIR, file_name)
		if file_name == "zh-CN.json":
			data = zh_original
		else:
			with open(abs_path, "r", encoding="utf-8") as handle:
				data = loads_locale(handle.read())
		apply_path_map(data, path_map)
		with open(abs_path, "w", encoding="utf-8", newline="\n") as handle:
			handle.write(dumps_locale(data))

	exclude_prefixes = load_exclude_prefixes()
	gitignore_spec = load_gitignore_spec()
	for rel in iter_source_files(gitignore_spec, exclude_prefixes):
		abs_path = os.path.join(FOUNT_DIR, rel)
		with open(abs_path, "r", encoding="utf-8") as handle:
			raw = handle.read()
		text, hits = rewrite_source_file(rel, raw, path_map)
		if not hits:
			continue
		with open(abs_path, "w", encoding="utf-8", newline="\n") as handle:
			handle.write(text)

	os.makedirs(os.path.dirname(MAP_PATH), exist_ok=True)
	ordered_map = OrderedDict(sorted(path_map.items(), key=lambda item: item[0]))
	with open(MAP_PATH, "w", encoding="utf-8", newline="\n") as handle:
		handle.write(json.dumps(ordered_map, ensure_ascii=False, indent="\t") + "\n")
	return 0


if __name__ == "__main__":
	if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
		sys.exit(self_test())
	sys.exit(main())
