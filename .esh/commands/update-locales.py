import json5
import json
import os
import copy
import re
import itertools
from deep_translator import GoogleTranslator
import time
from collections import OrderedDict, Counter
import sys

# ----------- 配置 -----------
# locales 文件夹相对于脚本的位置 (根据你的项目结构调整)
try:
	# __file__ 在直接运行时是脚本路径，但在某些打包或交互环境可能未定义
	MY_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
	# 如果 __file__ 不可用，假定脚本在项目根目录的某个子目录运行
	MY_DIR = os.path.abspath(".")
	print("警告: 无法确定脚本精确位置，假设在项目子目录中运行。")

LOCALE_DIR = os.path.join(MY_DIR, "../../src/locales")
FOUNT_DIR = os.path.join(MY_DIR, "../../")  # fount文件夹的路径

# 参考语言优先级列表
REFERENCE_LANG_CODES = [
	"zh-CN",
	"zh",
	"en-UK",
	"en",
	"ja",
	"ko",
	"fr",
	"de",
	"es",
	"it",
]
# 翻译API调用之间的最小延迟（秒）
TRANSLATION_DELAY = 0.6
# 同步最大迭代次数
MAX_SYNC_ITERATIONS = 10
# 占位符名称相似度修复阈值 (0.0 到 1.0，越高越严格，这里指 Levenshtein 距离与长度的比值，1.0 - dist/len)
# 或者使用绝对距离阈值，如下面的实现。
PLACEHOLDER_SIMILARITY_THRESHOLD_FACTOR = 0.7  # 用于计算最大可接受距离
PLACEHOLDER_ABSOLUTE_DISTANCE_THRESHOLD = 3  # 或者一个固定的最大编辑距离
# ----------- 配置结束 -----------

# 获取Google支持的语言代码字典和代码集合
try:
	supp_lang_translator = GoogleTranslator(source="auto", target="en")  # 临时实例
	SUPPORTED_GOOGLE_LANGS_DICT = supp_lang_translator.get_supported_languages(as_dict=True)
	SUPPORTED_GOOGLE_CODES = set(SUPPORTED_GOOGLE_LANGS_DICT.values())
	print(f"成功加载 Google Translator 支持的语言 ({len(SUPPORTED_GOOGLE_CODES)} 种)。")
except Exception as e:
	print(f"错误: 初始化 Google Translator 失败，无法获取支持语言列表: {e}")
	print("翻译功能将无法正常工作。请检查网络连接或 deep_translator 库。")
	SUPPORTED_GOOGLE_CODES = set()


def get_lang_from_filename(filename):
	"""从文件名提取语言代码"""
	return os.path.splitext(os.path.basename(filename))[0]


def get_value_at_path(data_dict, key_path):
	"""根据点分隔的路径从嵌套 OrderedDict 获取值"""
	keys = key_path.split(".")
	current_level = data_dict
	try:
		for key in keys:
			if isinstance(current_level, (OrderedDict, dict)):
				current_level = current_level.get(key)
				if current_level is None:
					return None, False
			else:
				return None, False
		return current_level, True
	except Exception:
		return None, False


def update_translation_at_path_in_data(target_lang_data, key_path, new_text_content, is_dict_with_text_field):
	"""
	辅助函数，用于更新 all_data 结构中特定路径的翻译字符串。
	如果 new_text_content 为 None，则表示清空，将设置为空字符串。
	返回 True 如果进行了更改，否则返回 False。
	"""
	keys = key_path.split(".")
	current_level_obj = target_lang_data
	for _, key_segment in enumerate(keys[:-1]):
		if not isinstance(current_level_obj, (OrderedDict, dict)) or key_segment not in current_level_obj:
			print(f"  错误: 更新时路径 '{key_path}' 在数据中无效于段 '{key_segment}'。")
			return False
		current_level_obj = current_level_obj[key_segment]

	final_key = keys[-1]
	if not isinstance(current_level_obj, (OrderedDict, dict)):
		print(f"  错误: 更新时父元素非字典类型，路径: '{key_path}' (父级键: '{keys[-2] if len(keys) > 1 else 'ROOT'}')。")
		return False

	original_node_value = current_level_obj.get(final_key)
	made_change = False

	# 如果 new_text_content 是 None，我们将其视为空字符串，表示清空或重置
	effective_text_content = "" if new_text_content is None else new_text_content

	if is_dict_with_text_field:
		if isinstance(original_node_value, (OrderedDict, dict)) and "text" in original_node_value:
			if original_node_value["text"] != effective_text_content:
				original_node_value["text"] = effective_text_content
				made_change = True
		else:
			new_node = OrderedDict([("text", effective_text_content)])
			if original_node_value != new_node:
				current_level_obj[final_key] = new_node
				made_change = True
	else:
		if original_node_value != effective_text_content:
			current_level_obj[final_key] = effective_text_content
			made_change = True

	return made_change


def find_best_translation_source(key_path, all_data, languages_map, reference_codes):
	"""根据参考语言优先级查找最佳翻译源。返回 (值, 源语言代码) 或 (None, None)。"""
	for ref_lang in reference_codes:
		path = next((p for p, lang in languages_map.items() if lang == ref_lang), None)
		if path and path in all_data:
			value, found = get_value_at_path(all_data[path], key_path)
			if found:
				if isinstance(value, str) and value.strip() == "":
					continue
				if isinstance(value, OrderedDict) and len(value) == 1 and "text" in value and isinstance(value["text"], str) and value["text"].strip() == "":
					continue
				return value, ref_lang
			else:
				return None, None  # If key not found in ref_lang, return None immediately
	return None, None


def align_placeholders_google_raw(original_text_with_placeholders: str, translated_text: str) -> str:
	"""
	(此函数用于 Google 翻译后的初步对齐，与修复逻辑中的 align_placeholders_with_list 不同)
	根据原始文本字符串对齐翻译后字符串中的占位符。
	1. 将 translated_text 中的 "$  {" 规范化为 "${"。
	2. 按顺序将 translated_text 中的占位符替换为 original_text_with_placeholders 中的占位符。
	"""
	if not isinstance(translated_text, str):
		return translated_text

	normalized_translated = re.sub(r"\$\s*\{", "${", translated_text)
	text_placeholders_content = re.findall(r"\$\{(.*?)\}", original_text_with_placeholders)

	if not text_placeholders_content:
		return normalized_translated

	canonical_content_iter = iter(text_placeholders_content)

	def replace_with_canonical_placeholder(match_obj):
		try:
			new_content = next(canonical_content_iter)
			return f"${{{new_content}}}"
		except StopIteration:
			return match_obj.group(0)

	final_translated = re.sub(r"\$\{(.*?)\}", replace_with_canonical_placeholder, normalized_translated)
	return final_translated


def get_compatible_code(code):
	"""Helper function to get a compatible Google Translate API language code."""
	if not SUPPORTED_GOOGLE_CODES:
		return code
	if code in SUPPORTED_GOOGLE_CODES:
		return code
	base_code = code.split("-")[0]
	if base_code in SUPPORTED_GOOGLE_CODES:
		return base_code
	code_lower = code.lower()
	for sc in SUPPORTED_GOOGLE_CODES:
		if sc.lower() == code_lower:
			return sc
	base_lower = base_code.lower()
	for sc in SUPPORTED_GOOGLE_CODES:
		if sc.lower() == base_lower:
			return sc
	return None


def perform_translation_with_retry(text: str, source_lang_code: str, target_lang_code: str, original_source_lang: str, original_target_lang: str) -> str | None:
	"""
	Performs translation with a retry mechanism using base language codes if the initial attempt fails.
	Returns the translated text or None if all attempts fail.
	"""
	print(f"    - 正在翻译: '{text[:50]}{'...' if len(text) > 50 else ''}' 从 {original_source_lang}({source_lang_code}) 到 {original_target_lang}({target_lang_code})")
	time.sleep(TRANSLATION_DELAY)

	try:
		translator = GoogleTranslator(source=source_lang_code, target=target_lang_code)
		translated_result = translator.translate(text)
		if translated_result is not None:
			# No alignment here, it will be done in the caller
			print(f"      - API翻译成功: '{translated_result[:50]}{'...' if len(translated_result) > 50 else ''}'")
			return translated_result
		else:
			# This case might not be typically hit if deep_translator raises an exception for failed translations
			print(f"    - 翻译 '{text[:50]}...' ({source_lang_code} -> {target_lang_code}) API返回None。")
			raise ValueError("翻译器返回 None")  # Force into exception handling for retry
	except Exception as e:
		print(f"    - 翻译 '{text[:50]}...' ({source_lang_code} -> {target_lang_code}) 初始失败: {e}")

		# Prepare for retry with base codes
		s_base = original_source_lang.split("-")[0]
		t_base = original_target_lang.split("-")[0]
		s_base_compat = get_compatible_code(s_base)
		t_base_compat = get_compatible_code(t_base)

		# Condition for retry:
		# 1. Compatible base codes exist.
		# 2. Base codes are different from the initially attempted codes (meaning there's something new to try).
		# 3. Base source and target are not the same (no point translating to itself).
		if s_base_compat and t_base_compat and (s_base_compat != source_lang_code or t_base_compat != target_lang_code) and s_base_compat != t_base_compat:
			print(f"      - 尝试备选 (基本代码): source={s_base_compat}, target={t_base_compat}")
			time.sleep(TRANSLATION_DELAY)
			try:
				translator_retry = GoogleTranslator(source=s_base_compat, target=t_base_compat)
				translated_result_retry = translator_retry.translate(text)
				if translated_result_retry is not None:
					# No alignment here
					print(f"      - 备选API翻译成功: '{translated_result_retry[:50]}{'...' if len(translated_result_retry) > 50 else ''}'")
					return translated_result_retry
				else:
					print(f"      - 尝试 {s_base_compat} -> {t_base_compat} API返回None。")
					return None  # Explicitly return None for this failure path
			except Exception as e2:
				print(f"      - 尝试 {s_base_compat} -> {t_base_compat} 失败: {e2}")
		# If retry is not applicable or fails
		print(f"    - 翻译 '{text[:50]}...' ({original_source_lang} -> {original_target_lang}) 所有尝试均失败。返回 None。")
		return None


def translate_text(text: str, source_lang: str, target_lang: str) -> str | None:
	"""
	Translates text using GoogleTranslator with compatibility checks and retry logic.
	Aligns placeholders after successful translation.
	Returns the translated text or None if translation fails.
	"""
	if not isinstance(text, str) or not text.strip() or source_lang == target_lang:
		return text  # Return original text if empty, not a string, or langs are same

	src_code_compat = get_compatible_code(source_lang)
	tgt_code_compat = get_compatible_code(target_lang)

	if src_code_compat is None:
		print(f"    - 错误: 源语言代码 '{source_lang}' 不被 Google Translator 支持或无法找到兼容代码。")
		return None  # Return None as per original behavior for failed translations
	if tgt_code_compat is None:
		print(f"    - 错误: 目标语言代码 '{target_lang}' 不被 Google Translator 支持或无法找到兼容代码。")
		return None  # Return None
	if src_code_compat == tgt_code_compat:
		return text  # Return original if, after compatibility, codes are the same

	translated_text_raw = perform_translation_with_retry(text, src_code_compat, tgt_code_compat, source_lang, target_lang)

	if translated_text_raw is not None:
		aligned_translated = align_placeholders_google_raw(text, translated_text_raw)
		print(f"      - 翻译成功 (Google对齐后): '{aligned_translated[:50]}{'...' if len(aligned_translated) > 50 else ''}'")
		return aligned_translated
	else:
		return None


def translate_value(value, source_lang, target_lang):
	"""递归地翻译值（字符串、列表或 OrderedDict）"""
	if isinstance(value, str):
		return translate_text(value, source_lang, target_lang)
	elif isinstance(value, OrderedDict):
		translated_dict = OrderedDict()
		for k, v in value.items():
			if k == "text" and isinstance(v, str):
				translated_dict[k] = translate_text(v, source_lang, target_lang)
			else:
				translated_dict[k] = translate_value(v, source_lang, target_lang)
		return translated_dict
	elif isinstance(value, list):
		return [translate_value(item, source_lang, target_lang) for item in value]
	else:
		return value


def normalize_string_or_text_obj(parent_dict_a, parent_dict_b, key, lang_a, lang_b, path):
	"""
	Normalizes cases where one value is a string and the other is an {'text': 'string'} object.
	Modifies the parent dictionary in place.
	Returns (val_a, val_b, changed_flag).
	"""
	val_a, val_b = parent_dict_a.get(key), parent_dict_b.get(key)
	changed_here = False

	is_val_a_str = isinstance(val_a, str)
	is_val_b_str = isinstance(val_b, str)
	is_val_a_text_obj = isinstance(val_a, OrderedDict) and "text" in val_a and isinstance(val_a["text"], str) and len(val_a) == 1
	is_val_b_text_obj = isinstance(val_b, OrderedDict) and "text" in val_b and isinstance(val_b["text"], str) and len(val_b) == 1

	if is_val_a_str and is_val_b_text_obj:
		parent_dict_a[key] = OrderedDict([("text", val_a)])
		val_a = parent_dict_a[key]
		print(f"  - 规范化: @ '{path}' 中 '{lang_a}' 的字符串值已转换为 {{'text': ...}} 以匹配 '{lang_b}'。")
		changed_here = True
	elif is_val_b_str and is_val_a_text_obj:
		parent_dict_b[key] = OrderedDict([("text", val_b)])
		val_b = parent_dict_b[key]
		print(f"  - 规范化: @ '{path}' 中 '{lang_b}' 的字符串值已转换为 {{'text': ...}} 以匹配 '{lang_a}'。")
		changed_here = True

	return val_a, val_b, changed_here


def handle_missing_key_translation(target_dict, source_dict, key, target_lang, source_lang_for_trans, current_path):
	"""
	Handles translation for a key missing in target_dict but present in source_dict.
	Returns True if a change was made (key added), False otherwise.
	"""
	made_change = False
	source_value_direct = source_dict[key]
	translated_val = translate_value(copy.deepcopy(source_value_direct), source_lang_for_trans, target_lang)

	if translated_val is not None:
		is_empty_str = isinstance(translated_val, str) and translated_val.strip() == ""
		is_empty_text_obj = isinstance(translated_val, OrderedDict) and "text" in translated_val and isinstance(translated_val["text"], str) and translated_val["text"].strip() == "" and len(translated_val) == 1

		if is_empty_str:
			print(f"  - 跳过添加: 键 '{current_path}' 的翻译结果为空字符串 (来自 {source_lang_for_trans} 到 {target_lang})。")
		elif is_empty_text_obj:
			print(f"  - 跳过添加: 键 '{current_path}' 的翻译结果为 {{'text': ''}} (来自 {source_lang_for_trans} 到 {target_lang})。")
		else:
			target_dict[key] = translated_val
			made_change = True
			print(f"  + 添加并翻译: 键 '{current_path}' 从 {source_lang_for_trans} 到 {target_lang}。")
	else:
		print(f"  - 跳过添加: 键 '{current_path}' 的翻译结果为 None (来自 {source_lang_for_trans} 到 {target_lang})。")

	return made_change


def sync_common_key(dict_a, dict_b, key, lang_a, lang_b, reference_codes, path):
	"""处理在两个字典中都存在的键。"""
	changed_here = False
	val_a, val_b, normalized_changed = normalize_string_or_text_obj(dict_a, dict_b, key, lang_a, lang_b, path)
	if normalized_changed:
		changed_here = True

	if isinstance(val_a, OrderedDict) and isinstance(val_b, OrderedDict):
		if normalize_and_sync_dicts(val_a, val_b, lang_a, lang_b, reference_codes, path):
			changed_here = True
	elif type(val_a) is not type(val_b):
		# 仅在无法通过 normalize_string_or_text_obj 自动规范化时发出警告
		is_val_a_text_like = isinstance(val_a, OrderedDict) and "text" in val_a and len(val_a) == 1
		is_val_b_text_like = isinstance(val_b, OrderedDict) and "text" in val_b and len(val_b) == 1
		if not ((isinstance(val_a, str) and is_val_b_text_like) or (isinstance(val_b, str) and is_val_a_text_like)):
			print(f"  - 警告: 类型不匹配 @ '{path}'. {lang_a}: {type(val_a).__name__}, {lang_b}: {type(val_b).__name__}。跳过同步。")
	return changed_here


def sync_unique_key(dict_has_key, dict_missing_key, lang_has_key, lang_missing_key, key, reference_codes, path):
	"""
	处理只存在于一个字典中的键。
	- 核心思想：以 reference_codes 列表中的最高优先级语言为准。
	- 如果一个键存在于高优先级语言中，而低优先级语言没有，则翻译并添加。
	- 如果一个键存在于低优先级语言中，而高优先级语言没有，则删除。
	"""
	try:
		# 获取两种语言在参考列表中的优先级（索引越小，优先级越高）
		# 如果语言不在列表中，给予一个极大的值，视为最低优先级
		priority_has_key = reference_codes.index(lang_has_key)
	except ValueError:
		priority_has_key = float('inf')

	try:
		priority_missing_key = reference_codes.index(lang_missing_key)
	except ValueError:
		priority_missing_key = float('inf')

	# 逻辑判断：
	# 1. 持有键的语言 (lang_has_key) 优先级更高
	if priority_has_key < priority_missing_key:
		# 这意味着 "源头" 语言有这个键，而目标语言没有。应该翻译。
		return handle_missing_key_translation(dict_missing_key, dict_has_key, key, lang_missing_key, lang_has_key, path)

	# 2. 缺失键的语言 (lang_missing_key) 优先级更高
	elif priority_missing_key < priority_has_key:
		# 这意味着 "源头" 语言没有这个键，而一个非源头语言却有。这是多余的，应该删除。
		print(f"  - 删除: 键 '{path}' 从 {lang_has_key} (因为它不在更高优先级的参考语言 {lang_missing_key} 中)")
		del dict_has_key[key]
		return True

	# 3. 优先级相同或两者都不在参考列表中（例如两个非参考语言之间的比较）
	# 在这种模糊情况下，我们默认采取更安全的操作：翻译并添加，而不是删除。
	else:
		return handle_missing_key_translation(dict_missing_key, dict_has_key, key, lang_missing_key, lang_has_key, path)

def normalize_and_sync_dicts(
	dict_a,
	dict_b,
	lang_a,
	lang_b,
	reference_codes_global,
	path="",
):
	"""
	(进一步重构后) 比较和同步两个字典，处理结构和内容差异。
	此版本使用单次循环处理所有键，逻辑更集中。
	"""
	changed_overall = False

	# 根级别处理 'lang' 键
	if path == "":
		if dict_a.get("lang") != lang_a:
			dict_a["lang"] = lang_a
			changed_overall = True
		if dict_b.get("lang") != lang_b:
			dict_b["lang"] = lang_b
			changed_overall = True

	# 合并键，保持 dict_a 的顺序，然后添加 dict_b 中独有的键
	combined_keys = list(dict.fromkeys(itertools.chain(dict_a.keys(), dict_b.keys())))

	# 单次遍历所有键
	for key in combined_keys:
		if key == "lang" and path == "":
			continue

		current_path = f"{path}.{key}" if path else key
		in_a = key in dict_a
		in_b = key in dict_b

		if in_a and in_b:
			# 情况 1: 键在两个字典中都存在
			if sync_common_key(dict_a, dict_b, key, lang_a, lang_b, reference_codes_global, current_path):
				changed_overall = True
		elif in_a:
			# 情况 2: 键只在 dict_a 中存在
			if sync_unique_key(dict_a, dict_b, lang_a, lang_b, key, reference_codes_global, current_path):
				changed_overall = True
		elif in_b:
			# 情况 3: 键只在 dict_b 中存在
			if sync_unique_key(dict_b, dict_a, lang_b, lang_a, key, reference_codes_global, current_path):
				changed_overall = True

	return changed_overall

def reorder_keys_like_reference(target_dict, reference_dict):
	if not isinstance(target_dict, OrderedDict) or not isinstance(reference_dict, OrderedDict):
		return target_dict
	ordered_target = OrderedDict()
	for key, ref_value in reference_dict.items():
		if key in target_dict:
			value = target_dict[key]
			if isinstance(value, OrderedDict) and isinstance(ref_value, OrderedDict):
				ordered_target[key] = reorder_keys_like_reference(value, ref_value)
			else:
				ordered_target[key] = value
	extra_keys = [key for key in target_dict.keys() if key not in reference_dict]
	for key in sorted(extra_keys):  # 对多余的键按字母排序以保持一致性
		ordered_target[key] = target_dict[key]
	return ordered_target


def remove_unavailable_languages_from_info(current_info_dict: OrderedDict, available_locale_langs: set, item_description: str):
	"""Removes languages from info dict if their locale files are not available."""
	langs_in_info_to_remove = []
	for lang in list(current_info_dict.keys()):  # Iterate over a copy for safe deletion
		locale_file_path = os.path.join(LOCALE_DIR, f"{lang}.json")
		if lang not in available_locale_langs and not os.path.exists(locale_file_path):
			langs_in_info_to_remove.append(lang)
		elif lang not in available_locale_langs and os.path.exists(locale_file_path):
			print(f"    - 警告: 语言 '{lang}' 在 {item_description} 的 info 中存在，但未在可用区域设置中加载。文件 '{os.path.basename(locale_file_path)}' 存在于磁盘。跳过删除。")

	for lang_code_to_remove in langs_in_info_to_remove:
		print(f"    - 从 {item_description} 的 info 中删除 '{lang_code_to_remove}' (关联的 locale 文件在 locales/ 中不存在且语言未加载)")
		del current_info_dict[lang_code_to_remove]


def determine_translation_source_for_info(current_info_dict: OrderedDict, global_ref_lang_codes: list[str]) -> tuple[str | None, OrderedDict | None]:
	"""Determines the source language and data for translating other info entries."""
	source_lang_in_info, source_data_from_info = None, None
	present_info_langs = set(current_info_dict.keys())

	for r_lang_code in global_ref_lang_codes:
		if r_lang_code in present_info_langs:
			source_lang_in_info = r_lang_code
			source_data_from_info = current_info_dict[r_lang_code]
			break
	if not source_lang_in_info and present_info_langs:
		source_lang_in_info = next(iter(sorted(list(present_info_langs))))
		source_data_from_info = current_info_dict[source_lang_in_info]
	return source_lang_in_info, source_data_from_info


def translate_missing_languages_for_info(current_info_dict: OrderedDict, langs_to_add_to_info: set, source_lang_in_info: str, source_data_from_info: OrderedDict, item_description: str) -> bool:
	"""Translates missing languages for the info dict, modifying it in place. Returns True if any translation was added."""
	if not isinstance(source_data_from_info, (dict, OrderedDict)):
		print(f"    - 警告: {item_description} 中源语言 '{source_lang_in_info}' 的数据不是字典。跳过翻译。")
		return False

	any_translation_added = False
	print(f"    - 为 {item_description} 的 info 翻译缺失语言 (目标: {', '.join(sorted(list(langs_to_add_to_info)))}), 源: '{source_lang_in_info}'")
	for target_lang_to_add in sorted(list(langs_to_add_to_info)):
		translated_item_content = OrderedDict()
		translation_successful_for_all_sub_keys = True
		for text_key, text_to_translate in source_data_from_info.items():
			if isinstance(text_to_translate, str):
				translated_text = translate_text(text_to_translate, source_lang_in_info, target_lang_to_add)
				if translated_text is None:
					print(f"      - 警告: {item_description} 中 '{text_key}' 从 '{source_lang_in_info}' 到 '{target_lang_to_add}' 翻译失败。跳过此子项。")
					translated_item_content[text_key] = text_to_translate
					translation_successful_for_all_sub_keys = False
				else:
					translated_item_content[text_key] = translated_text
			else:
				translated_item_content[text_key] = copy.deepcopy(text_to_translate)

		if translated_item_content and translation_successful_for_all_sub_keys:
			current_info_dict[target_lang_to_add] = translated_item_content
			any_translation_added = True
		elif not translation_successful_for_all_sub_keys:
			print(f"      - 警告: 由于部分子项翻译失败，未向 {item_description} 的info中添加 '{target_lang_to_add}'。")
	return any_translation_added


def reorder_info_dict_keys(current_info_dict: OrderedDict, global_ref_lang_codes: list[str]) -> OrderedDict:
	"""Reorders the keys in the info dictionary based on reference languages and then alphabetically."""
	final_ordered_info_dict = OrderedDict()
	for r_lang in global_ref_lang_codes:
		if r_lang in current_info_dict:
			final_ordered_info_dict[r_lang] = current_info_dict[r_lang]
	for lang_code_key in sorted(current_info_dict.keys()):
		if lang_code_key not in final_ordered_info_dict:
			final_ordered_info_dict[lang_code_key] = current_info_dict[lang_code_key]
	return final_ordered_info_dict


def process_registry_item_info(item_object_in_list, reg_key_list_name, item_index, available_locale_langs, global_ref_lang_codes):
	"""
	Processes the 'info' dictionary of a single item from a home_registry.json list.
	Modifies item_object_in_list['info'] in place.
	Returns True if changes were made, False otherwise.
	"""
	if not (isinstance(item_object_in_list, (dict, OrderedDict)) and "info" in item_object_in_list and isinstance(item_object_in_list["info"], (dict, OrderedDict))):
		return False

	current_info_dict = item_object_in_list["info"]
	if not isinstance(current_info_dict, OrderedDict):
		current_info_dict = OrderedDict(current_info_dict.items())

	original_info_dict_for_comparison = copy.deepcopy(current_info_dict)
	item_id_str = item_object_in_list.get("id", "未知ID")
	item_description = f"'{reg_key_list_name}' 项目 {item_index} (ID: {item_id_str})"

	remove_unavailable_languages_from_info(current_info_dict, available_locale_langs, item_description)

	present_info_langs_after_delete = set(current_info_dict.keys())
	langs_to_add_to_info = available_locale_langs - present_info_langs_after_delete

	if langs_to_add_to_info:
		if not present_info_langs_after_delete:
			print(f"    - 警告: {item_description} 的 info 为空，无法为 '{', '.join(sorted(list(langs_to_add_to_info)))}' 添加翻译。")
		else:
			source_lang, source_data = determine_translation_source_for_info(current_info_dict, global_ref_lang_codes)
			if source_lang and source_data:
				translate_missing_languages_for_info(current_info_dict, langs_to_add_to_info, source_lang, source_data, item_description)

	final_ordered_info_dict = reorder_info_dict_keys(current_info_dict, global_ref_lang_codes)

	if final_ordered_info_dict != original_info_dict_for_comparison:
		item_object_in_list["info"] = final_ordered_info_dict
		return True
	else:
		item_object_in_list["info"] = original_info_dict_for_comparison
		return False


def process_home_registries(map_lang_to_path, global_ref_lang_codes):
	if not os.path.isdir(FOUNT_DIR):
		print(f"警告: Fount 目录 '{FOUNT_DIR}' 不存在，跳过 home_registry.json 处理。")
		return
	available_locale_langs = set(map_lang_to_path.keys())
	if not available_locale_langs:
		print("警告: 没有加载任何有效的区域设置语言，无法处理 home_registry.json。")
		return

	print(f"\n--- 开始处理 Fount 目录 '{FOUNT_DIR}' 下的 home_registry.json 文件 ---")
	print(f"可用的区域语言 (来自 locales): {', '.join(sorted(list(available_locale_langs)))}")
	registry_keys_to_process = ["home_function_buttons", "home_char_interfaces", "home_world_interfaces", "home_persona_interfaces", "home_common_interfaces"]

	for root, _, files in os.walk(FOUNT_DIR):
		for filename in files:
			if filename == "home_registry.json":
				filepath = os.path.join(root, filename)
				print(f"\n处理文件: {filepath}")
				try:
					with open(filepath, "r", encoding="utf-8") as f:
						registry_data = json.load(f, object_pairs_hook=OrderedDict)
				except Exception as e:
					print(f"  错误: 无法加载或解析 {filepath}: {e}")
					continue

				file_changed_this_json = False
				for reg_key in registry_keys_to_process:
					if reg_key in registry_data and isinstance(registry_data[reg_key], list):
						for i, item in enumerate(registry_data[reg_key]):
							if process_registry_item_info(item, reg_key, i, available_locale_langs, global_ref_lang_codes):
								file_changed_this_json = True

				if file_changed_this_json:
					print(f"  检测到更改，正在保存文件: {filepath}")
					try:
						with open(filepath, "w", encoding="utf-8", newline="\n") as f:
							json.dump(registry_data, f, ensure_ascii=False, indent="\t", default=str)
							f.write("\n")
					except Exception as e:
						print(f"  错误: 保存 {filepath} 时出错: {e}")
				else:
					print(f"  文件 {filepath} 无需更改。")
	print("--- Fount 目录 home_registry.json 文件处理完毕 ---")


def check_used_keys_in_fount(fount_dir, reference_loc_data, reference_lang_code):
	if not os.path.isdir(fount_dir):
		print(f"警告: Fount 目录 '{fount_dir}' 不存在，跳过i18n键使用情况检查。")
		return

	print(f"\n--- 开始在 FOUNT 目录 '{fount_dir}' 中检查 MJS/HTML 文件中的 i18n 键 ---")
	regex_patterns = [re.compile(r"data-i18n=(?:\"([a-zA-Z0-9_.-]+)\"|'([a-zA-Z0-9_.-]+)')"), re.compile(r"geti18n\((?:\"([a-zA-Z0-9_.-]+)\"|'([a-zA-Z0-9_.-]+)')\)")]
	found_keys_in_fount_code = set()

	for root, _, files in os.walk(fount_dir):
		for filename in files:
			if filename.endswith((".mjs", ".html")):
				filepath = os.path.join(root, filename)
				try:
					with open(filepath, "r", encoding="utf-8") as f:
						content = f.read()
						for pattern in regex_patterns:
							for match_group in pattern.findall(content):
								key = next((s for s in match_group if s), None)
								if key:
									found_keys_in_fount_code.add(key.strip())
				except Exception as e:
					print(f"  警告: 读取或解析文件 {filepath} 失败: {e}")

	if not found_keys_in_fount_code:
		print("  在 FOUNT 目录的 MJS/HTML 文件中没有检测到任何 i18n 键的使用。")
		return

	print(f"  在 FOUNT 代码中检测到 {len(found_keys_in_fount_code)} 个唯一 i18n 键。正在与参考语言 '{reference_lang_code}' 数据比较...")
	missing_keys_count = 0
	for key in sorted(list(found_keys_in_fount_code)):
		_, found = get_value_at_path(reference_loc_data, key)
		if not found:
			print(f"  - 警告 (FOUNT): 代码中使用的键 '{key}' 在参考语言 '{reference_lang_code}' 的本地化数据中未找到。")
			missing_keys_count += 1

	if missing_keys_count == 0:
		print(f"  所有在 FOUNT 代码中使用的 {len(found_keys_in_fount_code)} 个 i18n 键均存在于参考语言 '{reference_lang_code}' 数据中。")
	else:
		print(f"  总计: {missing_keys_count} 个在 FOUNT 代码中使用的键在参考语言数据中缺失。")
	print("--- FOUNT 目录i18n键检查完毕 ---")


def extract_placeholders(text_string: str) -> list[str]:
	"""从字符串中提取占位符内容 (例如, 从 '${name}' 中提取 'name')。"""
	if not isinstance(text_string, str):
		return []
	return re.findall(r"\$\{(.*?)\}", text_string)


def collect_all_translatable_key_paths_recursive(current_data, current_path_prefix, collected_paths):
	"""递归收集指向可翻译字符串或简单 {"text": "string"} 对象的键路径。"""
	if isinstance(current_data, str):
		if current_path_prefix:
			collected_paths.add(current_path_prefix)
	elif isinstance(current_data, OrderedDict):
		is_simple_text_object = "text" in current_data and isinstance(current_data["text"], str) and all(key == "text" for key in current_data.keys())
		if is_simple_text_object:
			if current_path_prefix:
				collected_paths.add(current_path_prefix)
		else:
			for key, value in current_data.items():
				new_prefix = f"{current_path_prefix}.{key}" if current_path_prefix else key
				collect_all_translatable_key_paths_recursive(value, new_prefix, collected_paths)


def get_string_values_for_key_path(all_data_files, languages_map, key_path):
	"""辅助函数：为给定键路径获取所有语言的字符串值信息。"""
	string_values_info = {}
	for file_path, content_dict in all_data_files.items():
		lang_code = languages_map.get(file_path)
		if not lang_code:
			continue
		value_node, found = get_value_at_path(content_dict, key_path)
		if found:
			text_content, is_dict_obj = None, False
			if isinstance(value_node, str):
				text_content = value_node
			elif isinstance(value_node, OrderedDict) and "text" in value_node and isinstance(value_node["text"], str) and all(k == "text" for k in value_node.keys()):
				text_content = value_node["text"]
				is_dict_obj = True
			if text_content is not None:
				string_values_info[lang_code] = {"text": text_content, "file_path": file_path, "is_dict_obj": is_dict_obj}
	return string_values_info


def levenshtein_distance(s1, s2):
	"""计算两个字符串之间的 Levenshtein 距离。"""
	if len(s1) < len(s2):
		return levenshtein_distance(s2, s1)
	if len(s2) == 0:
		return len(s1)
	previous_row = range(len(s2) + 1)
	for i, c1 in enumerate(s1):
		current_row = [i + 1]
		for j, c2 in enumerate(s2):
			insertions = previous_row[j + 1] + 1
			deletions = current_row[j] + 1
			substitutions = previous_row[j] + (c1 != c2)
			current_row.append(min(insertions, deletions, substitutions))
		previous_row = current_row
	return previous_row[-1]


def handle_placeholder_count_mismatch(lang_code, lang_info, key_path, current_ph_list_ordered_len, most_frequent_count, lang_file_data) -> bool:
	"""处理占位符数量不匹配的情况：打印警告并清空翻译。"""
	reason = f"占位符数量不匹配 (当前: {current_ph_list_ordered_len}, 应为: {most_frequent_count})"
	print(f"    - 清理翻译: 键 '{key_path}' 在 '{lang_code}'. 原因: {reason}.")
	return update_translation_at_path_in_data(lang_file_data, key_path, None, lang_info["is_dict_obj"])


def handle_placeholder_name_mismatch(lang_code, lang_info, key_path, current_ph_list_ordered, canonical_placeholder_list_ordered, canonical_placeholder_set, lang_file_data) -> bool:
	"""处理占位符名称不匹配的情况：尝试修复或清空翻译。"""
	original_text = lang_info["text"]
	reason = f"占位符名称集不匹配 (当前: {sorted(list(set(current_ph_list_ordered)))}, 规范: {sorted(list(canonical_placeholder_set))})"
	print(f"    - {reason}。尝试修复键 '{key_path}' 在语言 '{lang_code}' 中的占位符名称...")

	fixed_text, repair_successful = attempt_placeholder_name_fix(original_text, current_ph_list_ordered, canonical_placeholder_list_ordered, canonical_placeholder_set, key_path, lang_code)

	if repair_successful and fixed_text is not None:
		return update_translation_at_path_in_data(lang_file_data, key_path, fixed_text, lang_info["is_dict_obj"])
	else:
		print(f"      - 无法自信地修复占位符名称。将清理翻译。键: '{key_path}', 语言: '{lang_code}'.")
		return update_translation_at_path_in_data(lang_file_data, key_path, None, lang_info["is_dict_obj"])


def align_placeholders_with_list(original_text_with_placeholders: str, new_placeholder_names: list[str]) -> str:
	"""使用 new_placeholder_names 中的名称按顺序替换 original_text_with_placeholders 中的占位符。"""
	if not isinstance(original_text_with_placeholders, str):
		return original_text_with_placeholders
	normalized_text = re.sub(r"\$\s*\{", "${", original_text_with_placeholders)

	def replace_match_factory(names_iter):
		def replace_match(match_obj):
			try:
				return f"${{{next(names_iter)}}}"
			except StopIteration:
				return match_obj.group(0)

		return replace_match

	if len(re.findall(r"\$\{(.*?)\}", normalized_text)) != len(new_placeholder_names):
		print("  - 警告 (占位符重建): 文本中的占位符数量与提供的名称列表长度不匹配。返回原文本。")
		return original_text_with_placeholders

	return re.sub(r"\$\{(.*?)\}", replace_match_factory(iter(new_placeholder_names)), normalized_text)


def find_canonical_placeholder_list(placeholders_by_lang: dict[str, list[str]], most_frequent_count: int, reference_lang_codes: list[str]) -> list[str] | None:
	"""根据参考语言优先级和最常见数量，确定规范的占位符列表。"""
	for ref_lang_code in reference_lang_codes:
		if ref_lang_code in placeholders_by_lang and len(placeholders_by_lang[ref_lang_code]) == most_frequent_count:
			return placeholders_by_lang[ref_lang_code]

	for lang_code in sorted(placeholders_by_lang.keys()):
		if len(placeholders_by_lang[lang_code]) == most_frequent_count:
			return placeholders_by_lang[lang_code]

	return None


def attempt_placeholder_name_fix(original_text: str, current_ph_list_ordered: list[str], canonical_placeholder_list_ordered: list[str], canonical_placeholder_set: set[str], key_path: str, lang_code: str) -> tuple[str | None, bool]:
	"""尝试修复占位符名称，返回 (修复后的文本 | None, 是否成功)"""
	if len(current_ph_list_ordered) != len(canonical_placeholder_list_ordered):
		print(f"      - 警告: 占位符数量不一致，无法进行名称修复 for key '{key_path}' in '{lang_code}'.")
		return None, False

	temp_repaired_list, used_canonical_indices = [], set()
	unmappable = False

	for current_name in current_ph_list_ordered:
		best_match_score, best_match_info = float("inf"), None
		for idx, canonical_name in enumerate(canonical_placeholder_list_ordered):
			if idx in used_canonical_indices:
				continue
			dist = levenshtein_distance(current_name, canonical_name)
			if dist < best_match_score:
				best_match_score, best_match_info = dist, (canonical_name, idx)

		if best_match_info and best_match_score <= PLACEHOLDER_ABSOLUTE_DISTANCE_THRESHOLD:
			best_canonical_match, best_canonical_idx = best_match_info
			temp_repaired_list.append(best_canonical_match)
			used_canonical_indices.add(best_canonical_idx)
		else:
			unmappable = True
			break

	if unmappable or len(temp_repaired_list) != len(canonical_placeholder_list_ordered):
		return None, False

	if set(temp_repaired_list) == canonical_placeholder_set:
		fixed_text = align_placeholders_with_list(original_text, temp_repaired_list)
		if fixed_text != original_text:
			print(f"      - 成功修复占位符名称: 原 '{current_ph_list_ordered}' -> 修 '{temp_repaired_list}'")
			return fixed_text, True
		return original_text, True

	return None, False


def align_single_translation_placeholders(lang_code: str, lang_info: dict, key_path: str, most_frequent_count: int, canonical_placeholder_list_ordered: list[str], canonical_placeholder_set: set[str], lang_file_data: OrderedDict, placeholders_by_lang: dict[str, list[str]]) -> bool:
	"""对单个语言条目的占位符进行对齐，返回是否发生更改。"""
	current_ph_list_ordered = placeholders_by_lang.get(lang_code, [])

	if len(current_ph_list_ordered) != most_frequent_count:
		return handle_placeholder_count_mismatch(lang_code, lang_info, key_path, len(current_ph_list_ordered), most_frequent_count, lang_file_data)
	elif set(current_ph_list_ordered) != canonical_placeholder_set:
		return handle_placeholder_name_mismatch(lang_code, lang_info, key_path, current_ph_list_ordered, canonical_placeholder_list_ordered, canonical_placeholder_set, lang_file_data)

	return False


def perform_global_placeholder_alignment(all_data_files, languages_map, reference_lang_codes_list):
	"""
	(重构后) 执行全局占位符验证和修复。
	遍历所有可翻译的键，比较各语言版本中的占位符，确保数量和名称（在一定容忍度内）一致。
	"""
	print("--- 开始全局占位符验证和修复过程 ---")
	overall_changes_made = False
	master_set_of_key_paths = set()
	for file_content_dict in all_data_files.values():
		collect_all_translatable_key_paths_recursive(file_content_dict, "", master_set_of_key_paths)

	if not master_set_of_key_paths:
		print("  未找到可进行占位符验证/修复的键路径。")
		return False

	print(f"  将分析 {len(master_set_of_key_paths)} 个唯一的键路径进行占位符一致性检查...")
	for key_path in sorted(list(master_set_of_key_paths)):
		string_values_info = get_string_values_for_key_path(all_data_files, languages_map, key_path)
		if not string_values_info:
			continue

		placeholders_by_lang = {lang: extract_placeholders(info["text"]) for lang, info in string_values_info.items()}
		counts = [len(p) for p in placeholders_by_lang.values()]
		if not counts:
			continue

		most_frequent_count = Counter(counts).most_common(1)[0][0]
		canonical_list = find_canonical_placeholder_list(placeholders_by_lang, most_frequent_count, reference_lang_codes_list)

		if canonical_list is None:
			if most_frequent_count == 0:
				canonical_list = []
			else:
				print(f"    - 警告: 键 '{key_path}' 无法确定规范占位符列表。跳过此键。")
				continue
		canonical_set = set(canonical_list)

		for lang_code, lang_info in string_values_info.items():
			lang_file_data = all_data_files.get(lang_info["file_path"])
			if not lang_file_data:
				continue

			if align_single_translation_placeholders(lang_code, lang_info, key_path, most_frequent_count, canonical_list, canonical_set, lang_file_data, placeholders_by_lang):
				overall_changes_made = True

	print("--- 全局占位符验证和修复过程已完成 ---")
	return overall_changes_made


# --- 主逻辑辅助函数 ---
def load_locale_files():
	"""从 LOCALE_DIR 加载所有 .json 文件。"""
	if not os.path.isdir(LOCALE_DIR):
		print(f"错误: 目录 '{LOCALE_DIR}' 不存在。")
		sys.exit(1)

	all_data, languages, lang_to_path = OrderedDict(), {}, {}
	print("加载本地化文件...")
	for filename in sorted(os.listdir(LOCALE_DIR)):
		if not filename.endswith(".json"):
			continue
		filepath = os.path.join(LOCALE_DIR, filename)
		lang = get_lang_from_filename(filename)
		if not lang:
			print(f"  - 警告: 无法从 '{filename}' 提取语言代码，跳过。")
			continue
		try:
			with open(filepath, "r", encoding="utf-8") as f:
				data = json5.load(f, object_pairs_hook=OrderedDict)
				if not isinstance(data, OrderedDict):
					print(f"  - 警告: 文件 {filename} 根部不是对象，跳过。")
					continue
				all_data[filepath] = data
				languages[filepath] = lang
				if lang in lang_to_path:
					print(f"  - 警告: 语言代码 '{lang}' 重复。将使用后加载的文件 '{filename}'。")
				lang_to_path[lang] = filepath
				print(f"  - 已加载: {filename} ({lang})")
		except Exception as e:
			print(f"  - 错误: 加载或解析 {filename} 失败: {e}。跳过。")

	if not all_data:
		print("未找到或加载任何有效的本地化文件。")
		sys.exit(1)
	return all_data, languages, lang_to_path


def find_reference_language(lang_to_path, all_data, languages):
	"""根据优先级列表确定参考语言和路径。"""
	for lang_code in REFERENCE_LANG_CODES:
		if lang_code in lang_to_path:
			ref_path = lang_to_path[lang_code]
			print(f"\n找到优先参考语言文件: {os.path.basename(ref_path)} ({lang_code})")
			return ref_path, lang_code

	first_path = next(iter(all_data.keys()))
	ref_lang = languages[first_path]
	print(f"\n警告: 未找到配置的参考语言。使用第一个加载的文件 '{os.path.basename(first_path)}' ({ref_lang}) 作为参考。")
	return first_path, ref_lang


def run_synchronization_loop(all_data, languages, ref_path):
	"""执行多轮同步，直到没有变化或达到最大迭代次数。"""
	if len(all_data) < 2:
		print("文件少于两个，跳过内容同步。")
		return

	print("\n--- 开始同步内容和结构 (locales) ---")
	for i in range(1, MAX_SYNC_ITERATIONS + 1):
		print(f"\n--- 同步迭代轮次 {i}/{MAX_SYNC_ITERATIONS} ---")
		changes_in_iter = False
		paths = sorted(list(all_data.keys()))
		# 优先与参考语言比较
		other_paths = [p for p in paths if p != ref_path]
		path_pairs = [(ref_path, p) for p in other_paths]
		# 然后在其他语言之间比较
		path_pairs.extend(itertools.combinations(other_paths, 2))

		for p_a, p_b in path_pairs:
			lang_a, lang_b = languages[p_a], languages[p_b]
			if normalize_and_sync_dicts(all_data[p_a], all_data[p_b], lang_a, lang_b, REFERENCE_LANG_CODES):
				changes_in_iter = True

		if not changes_in_iter:
			print("\n内容同步完成，本轮无更改。")
			break
		elif i == MAX_SYNC_ITERATIONS:
			print("\n警告：达到最大同步迭代次数，内容可能未完全收敛。")


def save_locale_files(all_data, ref_path):
	"""根据参考文件对所有文件进行排序并保存。"""
	if ref_path not in all_data:
		print(f"\n错误: 参考文件 '{os.path.basename(ref_path)}' 丢失，无法排序。")
		if not all_data:
			print("无数据可保存。")
			return
		ref_path = next(iter(all_data.keys()))
		print(f"将使用 '{os.path.basename(ref_path)}' 作为新的排序参考。")

	print(f"\n--- 开始根据参考文件 '{os.path.basename(ref_path)}' 排序并保存所有文件 ---")
	ref_data = all_data[ref_path]
	for filepath, data in all_data.items():
		all_data[filepath] = reorder_keys_like_reference(data, ref_data)

	for filepath, ordered_data in sorted(all_data.items()):
		try:
			with open(filepath, "w", encoding="utf-8", newline="\n") as f:
				json.dump(ordered_data, f, ensure_ascii=False, indent="\t", default=str)
				f.write("\n")
			print(f"  - 已保存: {os.path.basename(filepath)}")
		except Exception as e:
			print(f"  - 错误: 保存 {os.path.basename(filepath)} 时出错: {e}")


# --- 主逻辑 (重构后) ---
def main():
	"""主执行函数"""
	all_data, languages, lang_to_path = load_locale_files()

	ref_path, ref_lang = find_reference_language(lang_to_path, all_data, languages)

	first_ref_lang = next((lang for lang in REFERENCE_LANG_CODES if lang in lang_to_path), ref_lang)
	if first_ref_lang:
		check_used_keys_in_fount(FOUNT_DIR, all_data[lang_to_path[first_ref_lang]], first_ref_lang)
	else:
		print("\n警告: 未找到参考语言数据，跳过 FOUNT 目录i18n键检查。")

	run_synchronization_loop(all_data, languages, ref_path)

	if perform_global_placeholder_alignment(all_data, languages, REFERENCE_LANG_CODES):
		print("  占位符对齐过程检测到更改。如果翻译被清空，可能需要重新同步。")

	save_locale_files(all_data, ref_path)

	if lang_to_path:
		process_home_registries(lang_to_path, REFERENCE_LANG_CODES)
	else:
		print("\n警告: 无有效区域设置，跳过 home_registry.json 处理。")

	print("\n脚本执行完毕。")


if __name__ == "__main__":
	main()
