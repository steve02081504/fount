from pathlib import Path
from bs4 import BeautifulSoup
import contextlib
import pathspec
import sys

# 保证 Windows 控制台能正确输出
if sys.platform == "win32" and sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
	with contextlib.suppress(Exception):
		sys.stdout.reconfigure(encoding="utf-8")

# --- 配置 ---
# 需要检查的元数据标签
# 格式为: (标签名, {属性名: 属性值, ...})
# 如果您只想检查属性是否存在，而不是值，请将值设置为 None。
REQUIRED_TAGS = [
	("meta", {"charset": None}),
	("meta", {"name": "darkreader-lock"}),
	("meta", {"name": "viewport"}),
	("meta", {"property": "og:title"}),
	("meta", {"property": "og:type"}),
	("meta", {"property": "og:description"}),
	("meta", {"property": "og:image"}),
	("link", {"rel": "icon", "type": "image/svg+xml"}),
	("title", {}),  # 对于 title 标签，我们只检查标签本身是否存在
	("meta", {"name": "description"}),
]

# 要排除的路径片段。使用正斜杠，因为后面会用 as_posix() 来标准化路径。
EXCLUDE_PATH_FRAGMENTS = ["public/templates", "public/src/templates", "shells/easynew/parts"]

# --- 脚本主体 ---


def load_gitignore_spec(directory: Path) -> pathspec.PathSpec | None:
	"""
	加载 .gitignore 文件并返回一个可以用于匹配路径的 PathSpec 对象。

	:param directory: 项目的根目录 Path 对象。
	:return: 一个 PathSpec 对象，如果 .gitignore 不存在则返回 None。
	"""
	gitignore_path = directory / ".gitignore"
	if not gitignore_path.is_file():
		print("提示: 未在当前目录找到 .gitignore 文件，将扫描所有文件。")
		return None

	with open(gitignore_path, "r", encoding="utf-8") as f:
		# 使用 'gitwildmatch' 模式来正确解析 .gitignore 的语法
		return pathspec.PathSpec.from_lines("gitwildmatch", f)


def check_html_file(file_path: Path) -> list[str]:
	"""
	分析单个 HTML 文件，检查是否缺少必需的元数据。

	:param file_path: Path 对象，指向要检查的 HTML 文件。
	:return: 一个列表，包含所有缺失标签的描述。
	"""
	missing_tags = []
	try:
		with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
			soup = BeautifulSoup(f, "html.parser")

		head = soup.find("head")
		if not head:
			return []

		for tag_name, attrs in REQUIRED_TAGS:
			found = False
			# Special case for the SVG icon to make the check more robust.
			# It now accepts either type="image/svg+xml" OR an href ending in ".svg".
			if tag_name == "link" and attrs.get("rel") == "icon" and attrs.get("type") == "image/svg+xml":
				icon_links = head.find_all("link", rel="icon")
				for link in icon_links:
					href = link.get("href", "")
					link_type = link.get("type", "")
					if href.endswith(".svg") or link_type == "image/svg+xml":
						found = True
						break
			# Generic check for all other tags.
			else:
				# 对于 title，我们单独处理，因为它没有属性需要匹配
				if tag_name == "title":
					if head.find(tag_name):
						found = True
				# 对于其他标签，检查是否存在具有指定属性的标签
				else:
					# 查找所有同名标签
					tags = head.find_all(tag_name)
					for tag in tags:
						# 检查此标签是否匹配所有必需的属性和值
						all_attrs_match = True
						for key, value in attrs.items():
							if not tag.has_attr(key):
								all_attrs_match = False
								break
							# 如果要求的值不是 None，则检查值是否匹配
							if value is not None and tag.get(key) != value:
								all_attrs_match = False
								break

						if all_attrs_match:
							found = True
							break

			if not found:
				attr_str = " ".join([f'{k}="{v}"' if v else k for k, v in attrs.items()])
				missing_tags.append(f"<{tag_name} {attr_str}>")

	except Exception as e:
		return [f"处理文件时出错: {e}"]

	return missing_tags


def main():
	"""
	主函数，遍历文件并执行检查。
	"""
	current_directory = Path(".")
	warnings_found = False
	files_checked = 0

	print("--- 开始扫描 HTML 文件元数据 ---")

	# 1. 加载 .gitignore 规则
	gitignore_spec = load_gitignore_spec(current_directory)

	# 2. 查找所有 HTML 文件
	all_html_files = list(current_directory.rglob("*.html"))

	print(f"总共找到 {len(all_html_files)} 个 HTML 文件。正在进行过滤和分析...\n")

	for file_path in all_html_files:
		# 3. 过滤文件
		# 首先，忽略 .gitignore 中定义的文件
		if gitignore_spec and gitignore_spec.match_file(file_path):
			continue

		# 其次，检查文件路径是否以任何一个排除片段开头
		# .as_posix() 将路径转换为使用 '/' 的格式，确保跨平台兼容性
		path_as_posix = file_path.as_posix()
		if any(fragment in path_as_posix for fragment in EXCLUDE_PATH_FRAGMENTS):
			continue

		# 4. 对通过过滤的文件进行检查
		files_checked += 1
		missing = check_html_file(file_path)

		if missing:
			warnings_found = True
			# 使用 .as_posix() 保证在所有系统上路径都显示为 /
			print(f"⚠️  警告: 文件 '{file_path.as_posix()}' 缺少以下元数据标签:")
			for tag in missing:
				print(f"  - {tag}")
			print("-" * 20)

	print("\n--- 扫描完成 ---")
	if not warnings_found:
		print(f"✅  所有检查过的 {files_checked} 个 HTML 文件都包含了必需的元数据标签。")
	else:
		print(f"扫描了 {files_checked} 个文件，并发现了一些问题。")


if __name__ == "__main__":
	main()
