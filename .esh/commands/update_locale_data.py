import os
import json
import sys
import tempfile
from contextlib import redirect_stdout
from io import StringIO

locales_dir = os.path.abspath(os.path.join(os.getcwd(), "src", "public", "locales"))

USAGE = """\
Usage: update_locale_data "<python>"
       update_locale_data @script.py

# 写一个值
update_locale_data "set('some.key', 'some.value')"

# 读出来、挪到别处、删掉原键（set(key, None) 即删除）
update_locale_data "value = get('a.b.c'); if value is not None: set('d.f.g', value); set('a.b.c', None)"

# 调整同级顺序：把 a.c 挪到 a.b 后面（也可用 before= / index=）
update_locale_data "move('a.c', after='a.b')"

# 写入时顺便指定位置
update_locale_data "set('a.c', 'x', after='a.b')"

# 一次性排好同级键；没写到的键会接在后面。根级用 order('', ...)
update_locale_data "order('a', 'b', 'c', 'd')"

# 长脚本可写成文件，用 @ 传入（避免 shell 转义）
update_locale_data @restructure.py

# 还有 has(key)、keys(parent='') 可用；after/before 可写完整路径或同级短名
# file_name 为当前 locale 文件名（如 'it-IT.json'），可按语言分支
"""


def split_key(key):
	if key is None or key == "":
		return []
	return key.split(".")


def navigate_parent(obj, key_parts):
	"""走到父 dict；中间缺失则返回 None。"""
	current = obj
	for k in key_parts:
		if not isinstance(current, dict) or k not in current:
			return None
		current = current[k]
	return current if isinstance(current, dict) else None


def ensure_parent(obj, key_parts):
	"""走到父 dict；中间缺失则创建为空 dict。"""
	current = obj
	for k in key_parts:
		if not isinstance(current, dict):
			raise TypeError(f"Cannot descend into non-object at key segment '{k}'")
		if k not in current or not isinstance(current[k], dict):
			current[k] = {}
		current = current[k]
	return current


def get_nested_value(obj, key):
	parts = split_key(key)
	if not parts:
		return obj
	current = obj
	for k in parts:
		if isinstance(current, dict) and k in current:
			current = current[k]
		else:
			return None
	return current


def has_nested_key(obj, key):
	parts = split_key(key)
	if not parts:
		return True
	current = obj
	for k in parts:
		if not isinstance(current, dict) or k not in current:
			return False
		current = current[k]
	return True


def sibling_name(key, ref):
	"""
	把 after/before 引用解析为同级键名。
	允许传完整路径（须与 key 同父）或仅同级名。
	"""
	if ref is None:
		return None
	parent_parts = split_key(key)[:-1]
	ref_parts = split_key(ref)
	if len(ref_parts) == 1:
		return ref_parts[0]
	if ref_parts[:-1] != parent_parts:
		raise ValueError(f"'{ref}' is not a sibling of '{key}'")
	return ref_parts[-1]


def place_in_dict(d, key, value, *, after=None, before=None, index=None):
	"""
	在 dict 中放入 key=value，并按 after/before/index 决定位置。
	未指定定位且 key 已存在时，原地更新值（保持原顺序）。
	"""
	positioned = sum(x is not None for x in (after, before, index))
	if positioned > 1:
		raise ValueError("Use at most one of: after, before, index")

	if key in d and not positioned:
		d[key] = value
		return

	if key in d:
		del d[key]

	items = list(d.items())
	names = [k for k, _ in items]

	if after is not None:
		if after not in names:
			raise KeyError(f"after target '{after}' not found among siblings")
		pos = names.index(after) + 1
	elif before is not None:
		if before not in names:
			raise KeyError(f"before target '{before}' not found among siblings")
		pos = names.index(before)
	elif index is not None:
		n = len(items)
		pos = index if index >= 0 else n + index + 1
		pos = max(0, min(pos, n))
	else:
		pos = len(items)

	items.insert(pos, (key, value))
	d.clear()
	d.update(items)


def set_nested_value(obj, key, value, *, after=None, before=None, index=None):
	parts = split_key(key)
	if not parts:
		raise ValueError("Cannot set the root object")

	parent = ensure_parent(obj, parts[:-1])
	final_key = parts[-1]
	sib_after = sibling_name(key, after)
	sib_before = sibling_name(key, before)

	if value is None and after is None and before is None and index is None:
		parent.pop(final_key, None)
		return

	if value is None:
		raise ValueError("Cannot delete with a position; omit after/before/index")

	place_in_dict(parent, final_key, value, after=sib_after, before=sib_before, index=index)


def move_nested_key(obj, key, *, after=None, before=None, index=None):
	parts = split_key(key)
	if not parts:
		raise ValueError("Cannot move the root object")
	if after is None and before is None and index is None:
		raise ValueError("move() requires after, before, or index")

	parent = navigate_parent(obj, parts[:-1])
	if parent is None or parts[-1] not in parent:
		raise KeyError(f"Key '{key}' not found")

	final_key = parts[-1]
	value = parent[final_key]
	place_in_dict(
		parent,
		final_key,
		value,
		after=sibling_name(key, after),
		before=sibling_name(key, before),
		index=index,
	)


def order_nested_keys(obj, parent_key, *ordered_keys):
	parent = obj if not parent_key else navigate_parent(obj, split_key(parent_key))
	if parent is None:
		raise KeyError(f"Parent '{parent_key}' not found")
	if not isinstance(parent, dict):
		raise TypeError(f"Parent '{parent_key}' is not an object")

	missing = [k for k in ordered_keys if k not in parent]
	if missing:
		raise KeyError(f"Keys not found under '{parent_key or '<root>'}': {missing}")

	ordered = {k: parent[k] for k in ordered_keys}
	for k, v in parent.items():
		if k not in ordered:
			ordered[k] = v
	parent.clear()
	parent.update(ordered)


def list_nested_keys(obj, parent_key=""):
	parent = obj if not parent_key else navigate_parent(obj, split_key(parent_key))
	if parent is None:
		raise KeyError(f"Parent '{parent_key}' not found")
	if not isinstance(parent, dict):
		raise TypeError(f"Parent '{parent_key}' is not an object")
	return list(parent.keys())


def process_locale_files(script_to_run):
	errors = 0
	try:
		json_files = [f for f in os.listdir(locales_dir) if f.endswith(".json")]

		for file_name in json_files:
			file_path = os.path.join(locales_dir, file_name)
			print(f"Processing {file_name}...")

			try:
				with open(file_path, "r", encoding="utf-8") as f:
					original_content = f.read()
					data = json.loads(original_content)

				def get(key):
					return get_nested_value(data, key)

				def has(key):
					return has_nested_key(data, key)

				def keys(parent=""):
					return list_nested_keys(data, parent)

				def set(key, value, *, after=None, before=None, index=None):
					set_nested_value(data, key, value, after=after, before=before, index=index)

				def move(key, *, after=None, before=None, index=None):
					move_nested_key(data, key, after=after, before=before, index=index)

				def order(parent, *sibling_keys):
					order_nested_keys(data, parent, *sibling_keys)

				exec(
					script_to_run,
					{
						"get": get,
						"has": has,
						"keys": keys,
						"set": set,
						"move": move,
						"order": order,
						"file_name": file_name,
					},
				)

				updated_content = json.dumps(data, indent="\t", ensure_ascii=False) + "\n"
				if updated_content == original_content:
					print(f"Unchanged {file_name}.")
					continue
				with open(file_path, "w", encoding="utf-8", newline="\n") as f:
					f.write(updated_content)
				print(f"Successfully updated {file_name}.")

			except Exception as err:
				errors += 1
				print(f"Error processing file {file_name}: {err}", file=sys.stderr)

	except Exception as err:
		errors += 1
		print(f"Error reading locales directory: {err}", file=sys.stderr)
	return errors


def self_test() -> int:
	"""CLI 冒烟：--help 不得被当脚本 exec + 核心增删改移排操作。"""
	# 回归：--help/-h 应打印用法并退出 0，而不是被 exec（原报错 bad operand type for unary -: '_Helper'）
	for flag in ("--help", "-h"):
		out = StringIO()
		with redirect_stdout(out):
			code = main([flag])
		if code != 0 or "Usage:" not in out.getvalue():
			print(f"{flag} should print usage and exit 0, got code={code}", file=sys.stderr)
			return 1

	# 增改移删排 + 定位写入
	data = {"a": {"c": 1, "b": 2}}
	set_nested_value(data, "a.d", 3, after="a.b")
	if list(data["a"]) != ["c", "b", "d"]:
		print(f"set after= order unexpected: {list(data['a'])}", file=sys.stderr)
		return 1
	move_nested_key(data, "a.c", index=0)
	if list(data["a"]) != ["c", "b", "d"]:
		print(f"move index=0 order unexpected: {list(data['a'])}", file=sys.stderr)
		return 1
	set_nested_value(data, "a.c", None)
	if "c" in data["a"]:
		print("set(key, None) should delete", file=sys.stderr)
		return 1
	order_nested_keys(data, "a", "d", "b")
	if list(data["a"]) != ["d", "b"]:
		print(f"order result unexpected: {list(data['a'])}", file=sys.stderr)
		return 1
	if get_nested_value(data, "a.b") != 2 or has_nested_key(data, "a.b") is not True:
		print("get/has mismatch", file=sys.stderr)
		return 1
	if has_nested_key(data, "a.missing") is not False or get_nested_value(data, "a.missing") is not None:
		print("get/has missing mismatch", file=sys.stderr)
		return 1

	# 任一文件处理失败应让进程非零退出（脚本错误不应静默变绿）
	global locales_dir
	saved_dir = locales_dir
	with tempfile.TemporaryDirectory() as tmp:
		locales_dir = tmp
		with open(os.path.join(tmp, "bad.json"), "w", encoding="utf-8") as f:
			f.write("{}")
		errors = process_locale_files("undefined_name_xyz")
	locales_dir = saved_dir
	if errors < 1:
		print("process_locale_files should report per-file errors", file=sys.stderr)
		return 1

	print(json.dumps({"ok": True}))
	return 0


def main(argv):
	if not argv:
		print("Error: Please provide a script string to evaluate.", file=sys.stderr)
		print(USAGE, file=sys.stderr)
		return 1
	if argv[0] in ("-h", "--help"):
		print(USAGE)
		return 0
	if argv[0] == "--self-test":
		return self_test()
	arg = argv[0]
	if arg.startswith("@"):
		script_path = arg[1:]
		if not os.path.isabs(script_path) and not os.path.exists(script_path):
			alt = os.path.join(os.path.dirname(os.path.abspath(__file__)), script_path)
			if os.path.exists(alt):
				script_path = alt
		with open(script_path, "r", encoding="utf-8") as f:
			arg = f.read()
	try:
		compile(arg, "<update_locale_data>", "exec")
	except SyntaxError as err:
		print(f"Error: script is not valid Python: {err}", file=sys.stderr)
		print(USAGE, file=sys.stderr)
		return 1
	errors = process_locale_files(arg)
	return 1 if errors else 0


if __name__ == "__main__":
	sys.exit(main(sys.argv[1:]))
