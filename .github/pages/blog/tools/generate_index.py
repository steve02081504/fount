# -*- coding: utf-8 -*-
"""扫描 blog/articles/，聚合每篇文章的 frontmatter 与 meta.json，生成 index.json。

- articles/<id>/<locale>.md：YAML frontmatter（title / summary / tags）承担展示与搜索元数据。
- articles/<id>/meta.json：独立于展示的结构信息（category / order 等，透传未知键）。
- categories.json（可选，blog 根）：分类目录的定义（order + 各语言名称）。

产物 index.json 仅供运行时读取，属构建产物（已 gitignore）；部署管线与本地 pages 测试服务器都会执行本脚本。
校验失败（缺字段、未知 locale id、非法结构）时以非零码退出，令部署显式失败。
"""
import io
import json
import os
import re
import sys

try:
	import yaml
except ImportError:  # pragma: no cover - 运行环境缺 PyYAML 时退回内置子集解析器
	yaml = None

BLOG_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTICLES_DIR = os.path.join(BLOG_DIR, 'articles')
OUTPUT_PATH = os.path.join(BLOG_DIR, 'index.json')
CATEGORIES_PATH = os.path.join(BLOG_DIR, 'categories.json')
LOCALE_LIST_PATH = os.path.normpath(os.path.join(BLOG_DIR, '..', '..', '..', 'src', 'public', 'locales', 'list.csv'))

RESERVED_META_KEYS = {'langs'}
UNSET_ORDER = 1 << 30

FRONTMATTER_RE = re.compile(r'\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?', re.S)


class GenerateError(Exception):
	"""生成期校验失败。"""


def fail(message):
	raise GenerateError(message)


# ---------------------------------------------------------------------------
# frontmatter 解析
# ---------------------------------------------------------------------------

def parse_simple_yaml(text):
	"""内置 YAML 子集解析器：标量、`[a, b]` 行内列表、`- item` 块列表、一层嵌套。

	仅作为 PyYAML 缺席时的兜底；键值均按字符串/字符串列表处理。
	"""
	data = {}
	current_list_key = None
	for raw_line in text.splitlines():
		line = raw_line.rstrip()
		if not line.strip() or line.strip().startswith('#'):
			continue
		if line.lstrip().startswith('- '):
			if current_list_key is None:
				fail('fallback YAML: list item without a parent key')
			data[current_list_key].append(_strip_scalar(line.lstrip()[2:]))
			continue
		if ':' not in line:
			fail(f'fallback YAML: unsupported line: {line.strip()!r}')
		key, _, value = line.partition(':')
		key = key.strip()
		if not re.fullmatch(r'[A-Za-z_][\w-]*', key):
			fail(f'fallback YAML: unsupported key: {key!r}')
		value = value.strip()
		if not value:
			data[key] = []
			current_list_key = key
			continue
		current_list_key = None
		if value.startswith('[') and value.endswith(']'):
			inner = value[1:-1].strip()
			data[key] = [_strip_scalar(item) for item in inner.split(',')] if inner else []
			continue
		data[key] = _strip_scalar(value)
	return {key: value for key, value in data.items() if value != [] or key in data}


def _strip_scalar(value):
	value = value.strip()
	if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
		body = value[1:-1]
		if value[0] == '"':
			return body.replace('\\"', '"')
		return body.replace("''", "'")
	return value


def parse_frontmatter(md_path):
	"""提取并解析 md 文件的 frontmatter，返回 dict（缺失 frontmatter 视为错误）。"""
	text = io.open(md_path, encoding='utf-8').read()
	match = FRONTMATTER_RE.match(text)
	if not match:
		fail(f'{md_path}: missing YAML frontmatter (--- block at file head)')
	raw = match.group(1)
	if yaml is not None:
		try:
			data = yaml.safe_load(raw)
		except yaml.YAMLError as error:
			fail(f'{md_path}: invalid frontmatter YAML: {error}')
	else:
		data = parse_simple_yaml(raw)
	if data is None:
		data = {}
	if not isinstance(data, dict):
		fail(f'{md_path}: frontmatter must be a mapping')
	return data


# ---------------------------------------------------------------------------
# 字段规整
# ---------------------------------------------------------------------------

def as_text(value, where):
	if value is None:
		fail(f'{where}: value is missing')
	if isinstance(value, (int, float, bool)):
		value = str(value)
	if not isinstance(value, str):
		fail(f'{where}: expected a string, got {type(value).__name__}')
	value = value.strip()
	if not value:
		fail(f'{where}: value is empty')
	return value


def as_tags(value, where):
	if value is None:
		return []
	if not isinstance(value, list):
		fail(f'{where}: tags must be a list')
	tags = []
	for tag in value:
		if isinstance(tag, (int, float, bool)):
			tag = str(tag)
		if not isinstance(tag, str):
			fail(f'{where}: tags must be strings')
		tag = tag.strip()
		if tag and tag not in tags:
			tags.append(tag)
	return tags


def load_locale_ids():
	ids = set()
	with io.open(LOCALE_LIST_PATH, encoding='utf-8') as handle:
		for line in handle.read().splitlines()[1:]:
			code = line.split(',')[0].strip()
			if code:
				ids.add(code)
	return ids


def load_categories():
	"""读取 categories.json：{id: {order?, name?: {locale: 文案}}}。"""
	if not os.path.isfile(CATEGORIES_PATH):
		return {}
	data = json.load(io.open(CATEGORIES_PATH, encoding='utf-8'))
	if not isinstance(data, dict):
		fail('categories.json: root must be an object')
	categories = {}
	for category_id, definition in data.items():
		if not isinstance(definition, dict):
			fail(f'categories.json: {category_id} must be an object')
		order = definition.get('order')
		if order is not None and not isinstance(order, (int, float)):
			fail(f'categories.json: {category_id}.order must be a number')
		name = definition.get('name') or {}
		if not isinstance(name, dict):
			fail(f'categories.json: {category_id}.name must be an object')
		categories[category_id] = {
			'order': int(order) if order is not None else UNSET_ORDER,
			'name': {str(locale): as_text(value, f'categories.json: {category_id}.name.{locale}') for locale, value in name.items()},
		}
	return categories


def load_article_meta(article_dir, article_id):
	"""读取 meta.json：结构信息（category / order + 透传的未知键）。"""
	meta_path = os.path.join(article_dir, 'meta.json')
	if not os.path.isfile(meta_path):
		fail(f'{article_id}: missing meta.json')
	meta = json.load(io.open(meta_path, encoding='utf-8'))
	if not isinstance(meta, dict):
		fail(f'{article_id}/meta.json: root must be an object')
	for key in RESERVED_META_KEYS:
		if key in meta:
			fail(f'{article_id}/meta.json: reserved key {key!r}')
	category = meta.get('category', '')
	if not isinstance(category, str):
		fail(f'{article_id}/meta.json: category must be a string')
	order = meta.get('order')
	if order is not None and not isinstance(order, int):
		fail(f'{article_id}/meta.json: order must be an integer')
	entry = dict(meta)
	entry['id'] = article_id
	entry['category'] = category.strip()
	entry['order'] = order if order is not None else UNSET_ORDER
	return entry


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def collect_articles(locale_ids):
	if not os.path.isdir(ARTICLES_DIR):
		fail(f'missing articles directory: {ARTICLES_DIR}')
	articles = []
	for article_id in sorted(os.listdir(ARTICLES_DIR)):
		article_dir = os.path.join(ARTICLES_DIR, article_id)
		if not os.path.isdir(article_dir) or article_id.startswith('.'):
			continue
		entry = load_article_meta(article_dir, article_id)
		langs = {}
		for filename in sorted(os.listdir(article_dir)):
			if not filename.endswith('.md') or filename.startswith('.'):
				continue
			locale = filename[:-3]
			if locale not in locale_ids:
				fail(f'{article_id}/{filename}: {locale!r} is not a known locale id (see src/public/locales/list.csv)')
			front = parse_frontmatter(os.path.join(article_dir, filename))
			langs[locale] = {
				'title': as_text(front.get('title'), f'{article_id}/{filename}: title'),
				'summary': as_text(front.get('summary'), f'{article_id}/{filename}: summary'),
				'tags': as_tags(front.get('tags'), f'{article_id}/{filename}: tags'),
			}
		if not langs:
			fail(f'{article_id}: no <locale>.md files found')
		entry['langs'] = langs
		articles.append(entry)
	if not articles:
		fail('no articles found under articles/')
	return articles


def build_index(articles, categories):
	used_categories = {article['category'] for article in articles}
	for category_id in sorted(used_categories - set(categories)):
		categories[category_id] = {'order': UNSET_ORDER, 'name': {}}
	category_order = {
		category_id: (definition['order'], category_id)
		for category_id, definition in categories.items()
	}
	for article in articles:
		article['_category_rank'] = category_order.get(article['category'], (UNSET_ORDER, article['category']))
	articles.sort(key=lambda article: (article['_category_rank'], article['order'], article['id']))
	for article in articles:
		del article['_category_rank']

	return {
		'categories': [
			{
				'id': category_id,
				'order': categories[category_id]['order'],
				'name': categories[category_id]['name'],
			}
			for category_id in sorted(categories, key=lambda category_id: (categories[category_id]['order'], category_id))
		],
		'articles': articles,
	}


def main():
	locale_ids = load_locale_ids()
	categories = load_categories()
	articles = collect_articles(locale_ids)
	index = build_index(articles, categories)
	with io.open(OUTPUT_PATH, 'w', encoding='utf-8', newline='\n') as handle:
		handle.write(json.dumps(index, ensure_ascii=False, indent='\t') + '\n')
	lang_count = sum(len(article['langs']) for article in articles)
	print(f"blog index generated: {len(categories)} categories, {len(articles)} articles, {lang_count} locale files")


if __name__ == '__main__':
	try:
		main()
	except GenerateError as error:
		print(f'generate_index: {error}', file=sys.stderr)
		sys.exit(1)
