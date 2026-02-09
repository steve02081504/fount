"""
从所有 info.json 中移除 provider 字段；
对 info.dynamic.json 中缺少 provider 的 locale 发出警告；
当 info 的 emoji 对象内字符串内容包含中文、英文、俄文、日文任一时，对 emoji 本地化发出警告；
对 info.json / info.dynamic.json 中的 avatar URL 进行网络请求检查，若返回 404 则发出警告；
对 emoji 无 avatar（无字段或空串）的 info 发出警告，每文件一次。

用法：在项目根目录执行 python .esh/commands/verify-info.py
"""
from pathlib import Path
import contextlib
import json
import re
import sys
import time
import urllib.request
from urllib.parse import urlparse

# 保证 Windows 控制台能正确输出
if sys.platform == "win32" and sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
	with contextlib.suppress(Exception):
		sys.stdout.reconfigure(encoding="utf-8")

# --- 配置 ---
PARTS_DIR = Path("src/public/parts")
# 用于“emoji 本地化”警告：用正则检测字符串中是否出现各语言字符（中文 CJK、日文假名、俄文西里尔、英文拉丁）
EMOJI_LANG_PATTERNS = [
	("中文", re.compile(r"[\u4e00-\u9fff]")),
	("日文", re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")),
	("俄文", re.compile(r"[\u0400-\u04ff]")),
	("英文", re.compile(r"[a-zA-Z]")),
]
# emoji 语言检查时跳过这些键对应的值（不参与中/英/俄/日检测）
EMOJI_SKIP_KEYS = {"author", "avatar", "version", "home_page"}


def _collect_strings(obj, out: list[str]) -> None:
	"""递归收集 dict/list 中所有字符串到 out。"""
	if isinstance(obj, str):
		out.append(obj)
	elif isinstance(obj, dict):
		for v in obj.values():
			_collect_strings(v, out)
	elif isinstance(obj, list):
		for v in obj:
			_collect_strings(v, out)


def has_emoji_locale_warning(emoji_block: dict) -> tuple[bool, list[str]]:
	"""
	检查 emoji 对象内字符串是否包含中文、英文、俄文、日文任一种，若有则建议核对 emoji 本地化。
	略过 author、avatar、version、home_page 字段的值。
	:param emoji_block: info["emoji"] 的整块内容（dict）
	:return: (是否应警告, 已检测到的语言列表)
	"""
	strings = []
	for key, value in emoji_block.items():
		if key in EMOJI_SKIP_KEYS:
			continue
		_collect_strings(value, strings)
	text = " ".join(strings)
	found = [name for name, pat in EMOJI_LANG_PATTERNS if pat.search(text)]
	return (len(found) > 0, found)


def load_json(path: Path) -> dict | None:
	try:
		with open(path, "r", encoding="utf-8") as f:
			return json.load(f)
	except Exception as e:
		print(f"[!] 无法读取 '{path.as_posix()}': {e}")
		return None


def save_json(path: Path, data: dict) -> bool:
	try:
		with open(path, "w", encoding="utf-8", newline="\n") as f:
			json.dump(data, f, ensure_ascii=False, indent="\t")
		return True
	except Exception as e:
		print(f"[!] 无法写入 '{path.as_posix()}': {e}")
		return False


def remove_provider_from_info(data: dict) -> bool:
	"""从已加载的 info 结构中移除所有 locale 下的 provider 字段。返回是否做了修改。"""
	if not isinstance(data, dict):
		return False
	modified = False
	for value in data.values():
		if isinstance(value, dict) and "provider" in value:
			del value["provider"]
			modified = True
	return modified


def check_dynamic_provider(dynamic_path: Path) -> list[str]:
	"""检查 info.dynamic.json 中各 locale 是否包含 provider，返回缺少 provider 的 locale 列表。"""
	data = load_json(dynamic_path)
	if data is None or not isinstance(data, dict):
		return []
	missing = []
	for key, value in data.items():
		if isinstance(value, dict) and "provider" not in value:
			missing.append(key)
	return missing


# 匹配 "avatar": "https://..." 或 "avatar": "http://..."
AVATAR_LINE_RE = re.compile(r'^\s*"avatar"\s*:\s*"(https?://[^"]+)"\s*,?\s*$')


def collect_avatar_refs(parts_dir: Path) -> list[tuple[Path, int, str]]:
	"""从 parts 目录下所有 info.json 与 info.dynamic.json 中收集 (路径, 行号, avatar_url)。"""
	refs = []
	for name in ("info.json", "info.dynamic.json"):
		for path in sorted(parts_dir.rglob(name)):
			try:
				text = path.read_text(encoding="utf-8")
			except Exception as e:
				print(f"[!] 无法读取 '{path.as_posix()}': {e}")
				continue
			for line_no, line in enumerate(text.splitlines(), start=1):
				m = AVATAR_LINE_RE.match(line)
				if m:
					refs.append((path, line_no, m.group(1)))
	return refs


def is_avatar_url_404(url: str, timeout: float = 10.0) -> bool:
	"""先 HEAD（不拉 body，更友好），失败再回退 GET。仅当确认为 404 或两次都失败时返回 True。只允许 http/https 协议。"""
	parsed = urlparse(url)
	if parsed.scheme not in ("http", "https"):
		return False
	headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0"}

	def do_get():
		req = urllib.request.Request(url, headers=headers)
		with urllib.request.urlopen(req, timeout=timeout) as resp:
			return resp.status == 404

	try:
		req = urllib.request.Request(url, method="HEAD", headers=headers)
		with urllib.request.urlopen(req, timeout=timeout) as resp:
			return resp.status == 404
	except urllib.error.HTTPError as e:
		if e.code == 404:
			return True
		# 405/403 等或其它 HTTP 错误：回退 GET
		try:
			time.sleep(1)
			return do_get()
		except Exception:
			return True
	except Exception:
		# 超时、连接错误等：回退 GET
		try:
			return do_get()
		except Exception:
			return True


def main():
	root = Path(".")
	parts_dir = root / PARTS_DIR
	if not parts_dir.is_dir():
		print(f"错误: 未找到目录 {parts_dir.as_posix()}，请在项目根目录执行本脚本。")
		return

	info_files = sorted(parts_dir.rglob("info.json"))
	print("--- 开始处理 info.json（移除 provider）---")
	print(f"共找到 {len(info_files)} 个 info.json 文件。\n")

	removed_count = 0
	dynamic_warnings = []
	emoji_warnings = []
	emoji_no_avatar_paths = []  # 每文件一次
	avatar_404_refs = []  # [(path, url), ...]，每个文件每个 URL 仅一条

	for info_path in info_files:
		data = load_json(info_path)
		if data is None:
			continue

		# 1. 检查 emoji 对象内字符串是否含中/英/俄/日任一种，若有则建议核对 emoji 本地化
		if isinstance(data, dict):
			emoji_block = data.get("emoji")
			if isinstance(emoji_block, dict):
				should_warn, found_langs = has_emoji_locale_warning(emoji_block)
				if should_warn:
					emoji_warnings.append((info_path, found_langs))
				# emoji 无 avatar（无字段或空串）警告，每文件一次
				av = emoji_block.get("avatar")
				if av is None or av == "":
					emoji_no_avatar_paths.append(info_path)

		# 2. 移除 provider 并写回
		if remove_provider_from_info(data):
			if save_json(info_path, data):
				removed_count += 1
				print(f"  已移除 provider: {info_path.as_posix()}")

		# 3. 检查同目录下的 info.dynamic.json 是否缺少 provider，以及 emoji 无 avatar
		parent = info_path.parent
		dynamic_path = parent / "info.dynamic.json"
		if dynamic_path.is_file():
			data_dyn = load_json(dynamic_path)
			if data_dyn is not None and isinstance(data_dyn, dict):
				missing_locales = [k for k, v in data_dyn.items() if isinstance(v, dict) and "provider" not in v]
				if missing_locales:
					dynamic_warnings.append((dynamic_path, missing_locales))
				emoji_block = data_dyn.get("emoji")
				if isinstance(emoji_block, dict):
					av = emoji_block.get("avatar")
					if av is None or av == "":
						emoji_no_avatar_paths.append(dynamic_path)

	# 4. 收集 avatar URL 并检查 404（每个文件每个 URL 只警告一次）
	avatar_refs = collect_avatar_refs(parts_dir)
	url_to_refs = {}
	for path, line_no, url in avatar_refs:
		url_to_refs.setdefault(url, []).append((path, line_no))
	checked_404_urls = set()
	for url, refs in url_to_refs.items():
		if url in checked_404_urls:
			continue
		if is_avatar_url_404(url):
			checked_404_urls.add(url)
			seen_path_url = set()
			for path, line_no in refs:
				key = (path, url)
				if key not in seen_path_url:
					seen_path_url.add(key)
					avatar_404_refs.append((path, url))

	# 输出 info.dynamic.json 警告
	if dynamic_warnings:
		print("\n--- info.dynamic.json 缺少 provider 的 locale ---")
		for path, locales in dynamic_warnings:
			print(f"[!] {path.as_posix()}")
			print(f"    缺少 provider 的 locale: {', '.join(locales)}")
		print("-" * 20)

	# 输出 emoji 本地化警告（emoji 内字符串含中/英/俄/日任一时）
	if emoji_warnings:
		print("\n--- emoji 本地化检查（emoji 内字符串含 中文/英文/俄文/日文）---")
		for path, langs in emoji_warnings:
			print(f"[!] {path.as_posix()}")
			print(f"    检测到: {', '.join(langs)}，请确认 emoji 本地化已正确配置。")
		print("-" * 20)

	# 输出 avatar URL 404 警告（每个文件每个 URL 只一条）
	if avatar_404_refs:
		print("\n--- avatar URL 返回 404 ---")
		for path, url in avatar_404_refs:
			try:
				rel = path.relative_to(root)
			except ValueError:
				rel = path
			print(f"[!] {rel.as_posix()}")
			print(f"    avatar URL 不可用: {url}")
		print("-" * 20)

	# 输出 emoji 无 avatar 警告（每文件一次）
	if emoji_no_avatar_paths:
		print("\n--- emoji 无 avatar（无字段或空串）---")
		for path in emoji_no_avatar_paths:
			try:
				rel = path.relative_to(root)
			except ValueError:
				rel = path
			print(f"[!] {rel.as_posix()}")
		print("-" * 20)

	print("\n--- 处理完成 ---")
	print(f"已从 {removed_count} 个 info.json 中移除 provider 字段。")
	if not dynamic_warnings and not emoji_warnings and not avatar_404_refs and not emoji_no_avatar_paths:
		print("未发现 info.dynamic.json 缺 provider、emoji 本地化问题、avatar 404 或 emoji 无 avatar。")
	else:
		if dynamic_warnings:
			print(f"发现 {len(dynamic_warnings)} 个 info.dynamic.json 存在缺少 provider 的 locale。")
		if emoji_warnings:
			print(f"发现 {len(emoji_warnings)} 个 info 的 emoji 内字符串含中/英/俄/日，请核对 emoji 本地化。")
		if avatar_404_refs:
			print(f"发现 {len(avatar_404_refs)} 处 avatar URL 返回 404 或请求失败。")
		if emoji_no_avatar_paths:
			print(f"发现 {len(emoji_no_avatar_paths)} 个 info 的 emoji 无 avatar。")


if __name__ == "__main__":
	main()
