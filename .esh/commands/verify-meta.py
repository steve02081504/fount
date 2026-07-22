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
	("meta", {"name": "viewport"}),
	("meta", {"property": "og:title"}),
	("meta", {"property": "og:type"}),
	("meta", {"property": "og:description"}),
	("meta", {"property": "og:image"}),
	("link", {"rel": "icon", "type": "image/svg+xml"}),
	("title", {}),  # 对于 title 标签，我们只检查标签本身是否存在
	("meta", {"name": "description"}),
]

# ARIA in HTML：aside 允许的显式 role（含原生隐式 complementary）
ASIDE_ALLOWED_ROLES = frozenset({
	"complementary", "feed", "none", "note", "presentation", "region", "search", "status",
})

# --- 脚本主体 ---


def is_full_html_document(content: str) -> bool:
	"""
	通过内容判断是否为完整 HTML 文档（包含 html 根元素或 DOCTYPE）。
	仅完整文档需要检查元数据和 main 地标；片段/模板可跳过。

	:param content: HTML 文件原始内容。
	:return: 若为完整文档返回 True，否则返回 False。
	"""
	normalized = content.replace("\r", "").replace("\n", " ").lower()
	return "<!doctype html" in normalized or "<html" in normalized


def has_main_landmark(soup: BeautifulSoup) -> bool:
	"""
	检查文档是否包含 main 地标（<main> 元素）。
	主位置标记有助于屏幕阅读器用户浏览网页。

	:param soup: BeautifulSoup 解析后的文档。
	:return: 若存在 <main> 元素返回 True，否则返回 False。
	"""
	return soup.find("main") is not None


def check_drawer_toggles(soup: BeautifulSoup) -> list[str]:
	"""
	DaisyUI drawer-toggle 是纯 CSS 状态开关，应对辅助技术隐藏或提供可访问名称。
	对齐 Lighthouse「表单元素不具备关联的标签」对 #files-drawer-toggle 类问题的检出。
	"""
	issues = []
	for tag in soup.find_all("input", class_=lambda c: c and "drawer-toggle" in c):
		if tag.get("aria-hidden") == "true":
			continue
		if tag.has_attr("aria-label") or tag.has_attr("aria-labelledby") or tag.has_attr("data-i18n"):
			continue
		style = (tag.get("style") or "").replace(" ", "").lower()
		if "display:none" in style:
			continue
		ident = tag.get("id")
		if ident and soup.find("label", attrs={"for": ident}):
			continue
		issues.append(f'<input class="drawer-toggle" id="{ident or "drawer-toggle"}">（需 aria-hidden 或可访问名称）')
	return issues


def check_aside_aria_roles(soup: BeautifulSoup) -> list[str]:
	"""
	aside 上禁止使用 ARIA in HTML 不允许的 role。
	常见误用：aside + role=\"dialog\"（应改为 div role=dialog）。
	"""
	issues = []
	for tag in soup.find_all("aside"):
		role = (tag.get("role") or "").strip().lower()
		if not role or role in ASIDE_ALLOWED_ROLES:
			continue
		ident = tag.get("id") or " ".join(tag.get("class") or []) or "aside"
		issues.append(f'<aside … role="{role}"> ({ident})')
	return issues


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


def check_html_meta(soup: BeautifulSoup) -> list[str]:
	"""
	分析已解析的 HTML，检查是否缺少必需的元数据标签。

	:param soup: BeautifulSoup 解析后的文档。
	:return: 一个列表，包含所有缺失标签的描述。
	"""
	missing_tags = []
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

	return missing_tags


def main():
	"""
	主函数，遍历文件并执行检查。
	"""
	current_directory = Path(".")
	warnings_found = False
	files_checked = 0

	print("--- 开始扫描 HTML：元数据、main 地标、drawer-toggle、aside ARIA ---")

	# 1. 加载 .gitignore 规则
	gitignore_spec = load_gitignore_spec(current_directory)

	# 2. 查找所有 HTML 文件
	all_html_files = list(current_directory.rglob("*.html"))

	print(f"总共找到 {len(all_html_files)} 个 HTML 文件。通过内容匹配筛选完整文档并检查...\n")

	for file_path in all_html_files:
		# 3. 忽略 .gitignore 中定义的文件
		if gitignore_spec and gitignore_spec.match_file(file_path):
			continue

		# 4. 读取内容，仅对完整 HTML 文档进行检查
		try:
			content = file_path.read_text(encoding="utf-8", errors="ignore")
		except Exception as e:
			print(f"⚠️  无法读取文件 '{file_path.as_posix()}': {e}")
			warnings_found = True
			continue

		if not is_full_html_document(content):
			continue

		files_checked += 1
		soup = BeautifulSoup(content, "html.parser")
		missing_meta = check_html_meta(soup)
		missing_main = not has_main_landmark(soup)
		bad_toggles = check_drawer_toggles(soup)
		bad_aside_roles = check_aside_aria_roles(soup)

		if missing_meta or missing_main or bad_toggles or bad_aside_roles:
			warnings_found = True
			print(f"⚠️  警告: 文件 '{file_path.as_posix()}'")
			if missing_meta:
				print("  缺少元数据标签:")
				for tag in missing_meta:
					print(f"    - {tag}")
			if missing_main:
				print("  缺少 main 地标 (<main> 元素)")
			if bad_toggles:
				print("  drawer-toggle 未对辅助技术隐藏 / 缺少可访问名称:")
				for item in bad_toggles:
					print(f"    - {item}")
			if bad_aside_roles:
				print("  aside 上使用了不兼容的 ARIA role（dialog 等请用 div）:")
				for item in bad_aside_roles:
					print(f"    - {item}")
			print("-" * 20)

	print("\n--- 扫描完成 ---")
	if not warnings_found:
		print(f"✅  所有检查过的 {files_checked} 个完整 HTML 文档均通过元数据、main、drawer-toggle 与 aside ARIA 检查。")
	else:
		print(f"扫描了 {files_checked} 个完整 HTML 文档，并发现了一些问题。")


if __name__ == "__main__":
	main()
