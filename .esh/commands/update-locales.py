import json
import os
import copy
import re
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
	_supp_lang_translator = GoogleTranslator(source="auto", target="en")  # 临时实例
	SUPPORTED_GOOGLE_LANGS_DICT = _supp_lang_translator.get_supported_languages(as_dict=True)
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


def _update_translation_at_path_in_data(target_lang_data, key_path, new_text_content, is_dict_with_text_field):
	"""
	辅助函数，用于更新 all_data 结构中特定路径的翻译字符串。
	如果 new_text_content 为 None，则表示清空，将设置为空字符串。
	返回 True 如果进行了更改，否则返回 False。
	"""
	keys = key_path.split(".")
	current_level_obj = target_lang_data
	for i, key_segment in enumerate(keys[:-1]):
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


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
	"""翻译文本，包含重试逻辑、延时，并在翻译成功后对齐占位符。"""
	if not isinstance(text, str) or not text or source_lang == target_lang:
		return text

	def get_compatible_code(code):
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

	src_code_compat = get_compatible_code(source_lang)
	tgt_code_compat = get_compatible_code(target_lang)

	if src_code_compat is None:
		print(f"    - 错误: 源语言代码 '{source_lang}' 不被 Google Translator 支持。")
		return ""
	if tgt_code_compat is None:
		print(f"    - 错误: 目标语言代码 '{target_lang}' 不被 Google Translator 支持。")
		return ""
	if src_code_compat == tgt_code_compat:
		return text

	print(f"    - 正在翻译: '{text[:50]}{'...' if len(text) > 50 else ''}' 从 {source_lang}({src_code_compat}) 到 {target_lang}({tgt_code_compat})")
	time.sleep(TRANSLATION_DELAY)

	try:
		translator = GoogleTranslator(source=src_code_compat, target=tgt_code_compat)
		translated_result = translator.translate(text)
		if translated_result is not None:
			aligned_translated = align_placeholders_google_raw(text, translated_result)  # 使用 Google 对齐逻辑
			print(f"      - 翻译成功 (Google对齐后): '{aligned_translated[:50]}{'...' if len(aligned_translated) > 50 else ''}'")
			return aligned_translated
		else:
			raise ValueError("翻译器返回 None")
	except Exception as e:
		print(f"    - 翻译 '{text[:50]}...' ({src_code_compat} -> {tgt_code_compat}) 初始失败: {e}")
		s_base = source_lang.split("-")[0]
		t_base = target_lang.split("-")[0]
		s_base_compat = get_compatible_code(s_base)
		t_base_compat = get_compatible_code(t_base)

		if s_base_compat and t_base_compat and (s_base_compat != src_code_compat or t_base_compat != tgt_code_compat) and s_base_compat != t_base_compat:
			print(f"      - 尝试备选 (基本代码): source={s_base_compat}, target={t_base_compat}")
			time.sleep(TRANSLATION_DELAY)
			try:
				translator_retry = GoogleTranslator(source=s_base_compat, target=t_base_compat)
				translated_result_retry = translator_retry.translate(text)
				if translated_result_retry is not None:
					aligned_translated_retry = align_placeholders_google_raw(text, translated_result_retry)
					print(f"      - 备选翻译成功 (Google对齐后): '{aligned_translated_retry[:50]}{'...' if len(aligned_translated_retry) > 50 else ''}'")
					return aligned_translated_retry
			except Exception as e2:
				print(f"      - 尝试 {s_base_compat} -> {t_base_compat} 失败: {e2}")
		print(f"    - 翻译 '{text[:50]}...' ({source_lang} -> {target_lang}) 所有尝试均失败。返回 None。")
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


def normalize_and_sync_dicts(
	dict_a,
	dict_b,
	lang_a,
	lang_b,
	all_data_global,
	languages_global,
	reference_codes_global,
	path="",
):
	changed = False
	is_ref_lang_a = lang_a in reference_codes_global
	is_ref_lang_b = lang_b in reference_codes_global

	if path == "":
		lang_key = "lang"
		if lang_key not in dict_a or dict_a.get(lang_key) != lang_a:
			dict_a[lang_key] = lang_a
			changed = True
		if lang_key not in dict_b or dict_b.get(lang_key) != lang_b:
			dict_b[lang_key] = lang_b
			changed = True

	keys_a_ordered = list(dict_a.keys())
	keys_b_ordered = list(dict_b.keys())

	# Remove keys from non-reference language if not in reference language
	ref_dict = dict_a if is_ref_lang_a else (dict_b if is_ref_lang_b else None)
	non_ref_dict = dict_b if is_ref_lang_a else (dict_a if is_ref_lang_b else None)
	non_ref_lang = lang_b if is_ref_lang_a else (lang_a if is_ref_lang_b else None)

	if ref_dict and non_ref_dict:
		ref_keys = set(ref_dict.keys())
		non_ref_keys = set(non_ref_dict.keys())
		keys_to_remove = non_ref_keys - ref_keys

		for key in list(non_ref_dict.keys()):
			if key in keys_to_remove:
				print(f"  - 删除: 键 '{key}' 从 {non_ref_lang} (不在参考语言中)")
				del non_ref_dict[key]
				changed = True

	combined_keys = OrderedDict.fromkeys(keys_a_ordered)
	for k in keys_b_ordered:
		if k not in combined_keys:
			combined_keys[k] = None

	all_unique_keys_ordered = list(combined_keys.keys())
	if path == "" and "lang" in all_unique_keys_ordered:
		all_unique_keys_ordered.remove("lang")
		all_unique_keys_ordered.insert(0, "lang")

	for key in all_unique_keys_ordered:
		current_path = f"{path}.{key}" if path else key
		in_a, in_b = key in dict_a, key in dict_b
		if key == "lang" and path == "":
			continue

		if in_a and in_b:
			val_a, val_b = dict_a[key], dict_b[key]
			if isinstance(val_a, str) and isinstance(val_b, OrderedDict) and "text" in val_b and isinstance(val_b["text"], str) and len(val_b) == 1:
				dict_a[key] = OrderedDict([("text", val_a)])
				val_a = dict_a[key]
				changed = True
			elif isinstance(val_b, str) and isinstance(val_a, OrderedDict) and "text" in val_a and isinstance(val_a["text"], str) and len(val_a) == 1:
				dict_b[key] = OrderedDict([("text", val_b)])
				val_b = dict_b[key]
				changed = True

			if isinstance(val_a, OrderedDict) and isinstance(val_b, OrderedDict):
				if normalize_and_sync_dicts(val_a, val_b, lang_a, lang_b, all_data_global, languages_global, reference_codes_global, current_path):
					changed = True
			elif type(val_a) != type(val_b):
				print(f"  - 警告: 类型不匹配 @ '{current_path}'. {lang_a}: {type(val_a).__name__}, {lang_b}: {type(val_b).__name__}。跳过同步。")

	for key in all_unique_keys_ordered:  # 第二遍处理缺失键
		current_path = f"{path}.{key}" if path else key
		in_a, in_b = key in dict_a, key in dict_b
		if key == "lang" and path == "":
			continue

		target_dict, target_lang, source_dict, source_lang_for_trans, missing_in_lang = (None, None, None, None, None)
		if in_a and not in_b:
			target_dict, target_lang, source_dict, source_lang_for_trans, missing_in_lang = dict_b, lang_b, dict_a, lang_a, lang_b
		elif not in_a and in_b:
			target_dict, target_lang, source_dict, source_lang_for_trans, missing_in_lang = dict_a, lang_a, dict_b, lang_b, lang_a

		if target_dict is not None:  # 如果某个字典中缺失键
			source_value_direct = source_dict[key]
			translated_val = translate_value(copy.deepcopy(source_value_direct), source_lang_for_trans, target_lang)
			if translated_val is not None:
				if isinstance(translated_val, str) and translated_val == "":
					print(f"  - 跳过: 键 '{key}' 的翻译结果为空字符串，不添加到 {missing_in_lang}。")
				elif isinstance(translated_val, OrderedDict) and "text" in translated_val and isinstance(translated_val["text"], str) and translated_val["text"] == "" and len(translated_val) == 1:
					print(f"  - 跳过: 键 '{key}' 的翻译结果为 {{'text': ''}}，不添加到 {missing_in_lang}。")
				else:
					target_dict[key] = translated_val
					changed = True
			else:
				print(f"  - 跳过: 键 '{key}' 的翻译结果为 None，不添加到 {missing_in_lang}。")
			# 如果 translate_value 返回 None (例如翻译失败且返回空字符串，我们这里允许空字符串作为有效值)
			# 如果要严格处理 None，可以在这里添加逻辑。目前是如果返回 None，键不会被添加。
			# 但 translate_text 设计为返回 "" 而不是 None。

	return changed


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


def process_home_registries(map_lang_to_path, global_ref_lang_codes, all_locale_data_full):
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

				file_changed_overall = False
				for reg_key_list_name in registry_keys_to_process:
					if reg_key_list_name in registry_data and isinstance(registry_data[reg_key_list_name], list):
						print(f"  检查列表: '{reg_key_list_name}'")
						for item_index, item_object_in_list in enumerate(registry_data[reg_key_list_name]):
							if isinstance(item_object_in_list, (dict, OrderedDict)) and "info" in item_object_in_list and isinstance(item_object_in_list["info"], (dict, OrderedDict)):
								current_info_dict = item_object_in_list["info"]
								if not isinstance(current_info_dict, OrderedDict):
									current_info_dict = OrderedDict(current_info_dict.items())
								original_info_dict_for_comparison = copy.deepcopy(current_info_dict)
								item_id_str = item_object_in_list.get("id", "未知ID")
								item_description = f"'{reg_key_list_name}' 项目 {item_index} (ID: {item_id_str})"

								langs_in_info_to_remove = [lang for lang in current_info_dict if lang not in available_locale_langs]
								for lang_code_to_remove in langs_in_info_to_remove:
									print(f"    - 从 {item_description} 的 info 中删除 '{lang_code_to_remove}' (在 locales 中不存在)")
									del current_info_dict[lang_code_to_remove]

								present_info_langs_after_delete = set(current_info_dict.keys())
								langs_to_add_to_info = available_locale_langs - present_info_langs_after_delete

								if langs_to_add_to_info:
									if not present_info_langs_after_delete:
										print(f"    - 警告: {item_description} 的 info 为空，无法为 '{', '.join(sorted(list(langs_to_add_to_info)))}' 添加翻译。")
									else:
										source_lang_in_info, source_data_from_info = None, None
										for r_lang_code in global_ref_lang_codes:
											if r_lang_code in present_info_langs_after_delete:
												source_lang_in_info = r_lang_code
												source_data_from_info = current_info_dict[r_lang_code]
												break
										if not source_lang_in_info:
											source_lang_in_info = next(iter(present_info_langs_after_delete))
											source_data_from_info = current_info_dict[source_lang_in_info]

										if source_lang_in_info and isinstance(source_data_from_info, (dict, OrderedDict)):
											print(f"    - 为 {item_description} 的 info 翻译缺失语言 (目标: {', '.join(sorted(list(langs_to_add_to_info)))}), 源: '{source_lang_in_info}'")
											for target_lang_to_add in sorted(list(langs_to_add_to_info)):
												print(f"      - 翻译到 '{target_lang_to_add}'...")
												translated_item_content = OrderedDict()
												for text_key, text_to_translate in source_data_from_info.items():
													if isinstance(text_to_translate, str):
														translated_text = translate_text(text_to_translate, source_lang_in_info, target_lang_to_add)
														translated_item_content[text_key] = translated_text
													else:
														print(f"      - 警告: {item_description} 中 '{text_key}' 的值不是字符串。复制原值。")
														translated_item_content[text_key] = copy.deepcopy(text_to_translate)
												if translated_item_content:
													current_info_dict[target_lang_to_add] = translated_item_content
										elif source_lang_in_info:
											print(f"    - 警告: {item_description} 中源语言 '{source_lang_in_info}' 的数据不是字典。跳过翻译。")

								final_ordered_info_dict = OrderedDict()
								for r_lang in global_ref_lang_codes:
									if r_lang in current_info_dict:
										final_ordered_info_dict[r_lang] = current_info_dict[r_lang]
								for lang_code_key in sorted(current_info_dict.keys()):
									if lang_code_key not in final_ordered_info_dict:
										final_ordered_info_dict[lang_code_key] = current_info_dict[lang_code_key]

								if final_ordered_info_dict != original_info_dict_for_comparison:
									item_object_in_list["info"] = final_ordered_info_dict
									file_changed_overall = True
									# print(f"    - {item_description} 的 info 已更新/重新排序。")
								else:
									item_object_in_list["info"] = original_info_dict_for_comparison

				if file_changed_overall:
					print(f"  保存已修改的文件: {filepath}")
					try:
						with open(filepath, "w", encoding="utf-8", newline="\n") as f:
							json.dump(registry_data, f, ensure_ascii=False, indent="\t", default=str)
							f.write("\n")
					except Exception as e:
						print(f"  错误: 保存 {filepath} 时出错: {e}")
				else:
					print(f"  文件 {filepath} 无需更改。")
	print(f"--- Fount 目录 home_registry.json 文件处理完毕 ---")


def check_used_keys_in_fount(fount_dir, reference_loc_data, reference_lang_code):
	if not os.path.isdir(fount_dir):
		print(f"警告: Fount 目录 '{fount_dir}' 不存在，跳过i18n键使用情况检查。")
		return

	print(f"\n--- 开始在 FOUNT 目录 '{fount_dir}' 中检查 MJS/HTML 文件中的 i18n 键 ---")
	regex_patterns = [re.compile(r"data-i18n=(?:\"([a-zA-Z0-9_.-]+)\"|'([a-zA-Z0-9_.-]+)')"), re.compile(r"geti18n\((?:\"([a-zA-Z0-9_.-]+)\"|'([a-zA-Z0-9_.-]+)')\)")]
	found_keys_in_fount_code = set()

	for root, _, files in os.walk(fount_dir):
		for filename in files:
			if filename.endswith(".mjs") or filename.endswith(".html"):
				filepath = os.path.join(root, filename)
				try:
					with open(filepath, "r", encoding="utf-8") as f:
						content = f.read()
						for pattern in regex_patterns:
							matches = pattern.findall(content)
							for match_group in matches:
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


def _extract_placeholders(text_string: str) -> list[str]:
	"""从字符串中提取占位符内容 (例如, 从 '${name}' 中提取 'name')。"""
	if not isinstance(text_string, str):
		return []
	return re.findall(r"\$\{(.*?)\}", text_string)


def _collect_all_translatable_key_paths_recursive(current_data, current_path_prefix, collected_paths):
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
				_collect_all_translatable_key_paths_recursive(value, new_prefix, collected_paths)


def _get_string_values_for_key_path(all_data_files, languages_map, key_path):
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


def align_placeholders_with_list(original_text_with_placeholders: str, new_placeholder_names: list[str]) -> str:
	"""
	使用 new_placeholder_names 中的名称按顺序替换 original_text_with_placeholders 中的占位符。
	original_text_with_placeholders 中的占位符数量必须与 len(new_placeholder_names) 匹配。
	"""
	if not isinstance(original_text_with_placeholders, str):
		return original_text_with_placeholders
	normalized_text = re.sub(r"\$\s*\{", "${", original_text_with_placeholders)
	matches = list(re.finditer(r"\$\{(.*?)\}", normalized_text))

	if len(matches) != len(new_placeholder_names):
		print(f"  - 警告 (占位符重建): 文本中的占位符数量 ({len(matches)}) 与提供的名称列表长度 ({len(new_placeholder_names)}) 不匹配。返回原文本。文本: '{original_text_with_placeholders[:50]}...'")
		return original_text_with_placeholders

	new_names_iter = iter(new_placeholder_names)

	def replace_match(match_obj):
		try:
			return f"${{{next(new_names_iter)}}}"
		except StopIteration:
			return match_obj.group(0)

	return re.sub(r"\$\{(.*?)\}", replace_match, normalized_text)


def perform_global_placeholder_alignment(all_data_files, languages_map, reference_lang_codes_list):
	"""
	执行全局占位符验证，并尝试修复轻微的名称差异。
	1. 确定最常见的占位符数量和规范的占位符名称列表（有序）。
	2. 对每个翻译：
		a. 如果数量不匹配，则清空翻译。
		b. 如果数量匹配但名称集不匹配：
			i. 尝试使用字符串相似度将当前名称映射到规范名称。
			ii. 如果找到可信的映射（所有名称都映射成功，且映射后的名称集与规范集一致），
				则纠正翻译中的占位符名称，并保留原始顺序。
			iii. 否则（无法可信地映射），清空翻译。
		c. 如果数量和名称（作为集合）都匹配，则保留翻译（顺序也被保留）。
	返回 True 如果进行了任何更改。
	"""
	print("  开始全局占位符验证和修复过程...")
	overall_changes_made = False
	master_set_of_key_paths = set()
	for file_content_dict in all_data_files.values():
		_collect_all_translatable_key_paths_recursive(file_content_dict, "", master_set_of_key_paths)

	if not master_set_of_key_paths:
		print("  未找到可进行占位符验证/修复的键路径。")
		return False

	print(f"  将分析 {len(master_set_of_key_paths)} 个唯一的键路径进行占位符一致性检查...")

	for key_path in sorted(list(master_set_of_key_paths)):
		string_values_info_for_key = _get_string_values_for_key_path(all_data_files, languages_map, key_path)
		if not string_values_info_for_key:
			continue

		placeholders_by_lang = {lang: _extract_placeholders(info["text"]) for lang, info in string_values_info_for_key.items()}
		placeholder_counts = [len(ph_list) for ph_list in placeholders_by_lang.values()]
		if not placeholder_counts:
			continue

		count_frequencies = Counter(placeholder_counts)
		most_frequent_count = count_frequencies.most_common(1)[0][0]

		canonical_placeholder_list_ordered = None
		for ref_lang_code in reference_lang_codes_list:
			if ref_lang_code in placeholders_by_lang and len(placeholders_by_lang[ref_lang_code]) == most_frequent_count:
				canonical_placeholder_list_ordered = placeholders_by_lang[ref_lang_code]
				break
		if canonical_placeholder_list_ordered is None:
			for lang_c_sorted in sorted(placeholders_by_lang.keys()):
				if len(placeholders_by_lang[lang_c_sorted]) == most_frequent_count:
					canonical_placeholder_list_ordered = placeholders_by_lang[lang_c_sorted]
					break

		if canonical_placeholder_list_ordered is None:
			if most_frequent_count == 0:
				canonical_placeholder_list_ordered = []
			else:
				print(f"    - 警告 (占位符): 键 '{key_path}' 无法确定规范占位符列表 (最常见数量 {most_frequent_count})。跳过此键。")
				continue
		canonical_placeholder_set = set(canonical_placeholder_list_ordered)

		for lang_code, lang_info in string_values_info_for_key.items():
			original_text = lang_info["text"]
			current_ph_list_ordered = placeholders_by_lang.get(lang_code, [])
			action_type, reason = None, ""

			if len(current_ph_list_ordered) != most_frequent_count:
				action_type = "clear"
				reason = f"占位符数量不匹配 (当前: {len(current_ph_list_ordered)}, 应为: {most_frequent_count})"
			else:
				current_ph_set = set(current_ph_list_ordered)
				if current_ph_set != canonical_placeholder_set:  # 数量一致，但名称集不同
					action_type = "try_fix_names"
					reason = f"占位符名称集不匹配 (当前: {sorted(list(current_ph_set))}, 规范: {sorted(list(canonical_placeholder_set))})"
				# else: 数量和名称集都一致，无需操作 (保留原始顺序)

			if action_type == "clear":
				print(f"    - 清理翻译: 键 '{key_path}' 在 '{lang_code}'. 原因: {reason}.")
				if _update_translation_at_path_in_data(all_data_files[lang_info["file_path"]], key_path, None, lang_info["is_dict_obj"]):
					overall_changes_made = True

			elif action_type == "try_fix_names":
				print(f"    - {reason}。尝试修复键 '{key_path}' 在语言 '{lang_code}' 中的占位符名称...")
				repaired_ph_list_ordered, unmappable = [], False
				available_canonical_names = list(canonical_placeholder_list_ordered)  # 可用的规范名称副本

				if len(current_ph_list_ordered) == len(canonical_placeholder_list_ordered):  # 再次确认数量一致
					temp_repaired_list = []
					used_canonical_indices = set()  # 确保规范名称一对一使用

					for current_name_in_text in current_ph_list_ordered:
						best_match_score, best_canonical_match, best_canonical_idx = float("inf"), None, -1

						for idx, canonical_name_option in enumerate(canonical_placeholder_list_ordered):
							if idx in used_canonical_indices:
								continue  # 此规范名称已被用于之前的匹配

							dist = levenshtein_distance(current_name_in_text, canonical_name_option)
							if dist < best_match_score:
								best_match_score = dist
								best_canonical_match = canonical_name_option
								best_canonical_idx = idx
							elif dist == best_match_score:  # 平局处理：选择字母顺序靠前的或更短的
								if best_canonical_match is None or len(canonical_name_option) < len(best_canonical_match) or (len(canonical_name_option) == len(best_canonical_match) and canonical_name_option < best_canonical_match):
									best_canonical_match = canonical_name_option
									best_canonical_idx = idx

						if best_canonical_match is not None:
							# 阈值判断：这里使用绝对距离阈值
							if best_match_score <= PLACEHOLDER_ABSOLUTE_DISTANCE_THRESHOLD:
								temp_repaired_list.append(best_canonical_match)
								used_canonical_indices.add(best_canonical_idx)  # 标记此规范名称已用
							else:
								temp_repaired_list.append(current_name_in_text)  # 相似度太低，保留原样
								unmappable = True
								break  # 一个匹配不好，则认为整个修复失败
						else:  # 没有找到任何可用的规范名称（理论上不应发生，因为数量一致）
							unmappable = True
							break

					if not unmappable and len(temp_repaired_list) == len(current_ph_list_ordered):
						if set(temp_repaired_list) == canonical_placeholder_set:  # 确保修复后的集合是规范的
							repaired_ph_list_ordered = temp_repaired_list
						else:
							unmappable = True  # 修复后的集合仍不等于规范集（例如，多个映射到同一个规范名称）
					else:
						unmappable = True
				else:
					unmappable = True  # 数量不一致，不应在此处，但作为防御

				if not unmappable and repaired_ph_list_ordered:
					fixed_text = align_placeholders_with_list(original_text, repaired_ph_list_ordered)
					if fixed_text != original_text:
						print(f"      - 成功修复占位符名称 (保留顺序): 原 '{original_text[:50]}...' -> 修 '{fixed_text[:50]}...' (修复列表: {repaired_ph_list_ordered})")
						if _update_translation_at_path_in_data(all_data_files[lang_info["file_path"]], key_path, fixed_text, lang_info["is_dict_obj"]):
							overall_changes_made = True
				else:
					print(f"      - 无法自信地修复占位符名称。将清理翻译。键: '{key_path}', 语言: '{lang_code}'.")
					if _update_translation_at_path_in_data(all_data_files[lang_info["file_path"]], key_path, None, lang_info["is_dict_obj"]):  # 此处修正了 is_doc_obj
						overall_changes_made = True

	if overall_changes_made:
		print("  全局占位符验证和修复过程已完成。")
	else:
		print("  全局占位符验证和修复检查完成，未发现需要更改的内容。")
	return overall_changes_made


# --- 主逻辑 ---
def main():
	if not os.path.isdir(LOCALE_DIR):
		print(f"错误: 目录 '{LOCALE_DIR}' 不存在或不是有效目录。")
		print(f"脚本预期目录位置: {os.path.abspath(LOCALE_DIR)}")
		sys.exit(1)

	all_data = OrderedDict()
	languages = {}  # path -> lang
	lang_to_path = {}  # lang -> path

	print("加载本地化文件...")
	locale_files = sorted([f for f in os.listdir(LOCALE_DIR) if f.endswith(".json")])
	if not locale_files:
		print(f"错误: 在 '{LOCALE_DIR}' 中没有找到 JSON 文件。")
		sys.exit(1)

	for filename in locale_files:
		filepath = os.path.join(LOCALE_DIR, filename)
		lang = get_lang_from_filename(filename)
		if not lang:
			print(f"  - 警告: 无法从文件名 '{filename}' 提取语言代码，跳过。")
			continue
		try:
			with open(filepath, "r", encoding="utf-8") as f:
				loaded_data = json.load(f, object_pairs_hook=OrderedDict)
				if not isinstance(loaded_data, OrderedDict):
					print(f"  - 警告: 文件 {filename} 根部不是一个 JSON 对象。跳过。")
					continue
				all_data[filepath] = loaded_data
				languages[filepath] = lang
				if lang in lang_to_path:  # 处理重复语言代码
					print(f"  - 警告: 语言代码 '{lang}' 在文件 '{filename}' 和 '{os.path.basename(lang_to_path[lang])}' 中重复。将使用后加载的文件 '{filename}'。")
				lang_to_path[lang] = filepath
				print(f"  - 已加载: {filename} ({lang})")
		except json.JSONDecodeError as e:
			print(f"  - 错误: 解析 {filename} 时出错: {e}. 请检查 JSON 格式。跳过。")
		except Exception as e:
			print(f"  - 错误: 加载 {filename} 时发生未知错误: {e}. 跳过。")

	if len(all_data) < 1:
		print("未找到有效的本地化文件或加载失败。")
		sys.exit(1)

	ref_path, ref_lang = None, None
	for lang_code_pref in REFERENCE_LANG_CODES:
		if lang_code_pref in lang_to_path:
			ref_path = lang_to_path[lang_code_pref]
			ref_lang = lang_code_pref
			print(f"\n找到优先参考语言文件: {os.path.basename(ref_path)} ({ref_lang})")
			break
	if not ref_path:
		first_filepath_loaded = next(iter(all_data.keys()))
		ref_path = first_filepath_loaded
		ref_lang = languages[ref_path]
		print(f"\n警告: 未找到配置的参考语言。使用加载的第一个文件 '{os.path.basename(ref_path)}' ({ref_lang}) 作为参考。")

	first_ref_lang = None
	for lang_code_pref in REFERENCE_LANG_CODES:
		if lang_code_pref in lang_to_path:
			first_ref_lang = lang_code_pref
			break

	if first_ref_lang and lang_to_path[first_ref_lang] in all_data:
		check_used_keys_in_fount(FOUNT_DIR, all_data[lang_to_path[first_ref_lang]], first_ref_lang)
	else:
		print("\n警告: 未找到有效的参考语言文件数据，跳过 FOUNT 目录中的i18n键检查。")

	print("\n开始同步内容和结构 (locales)...")
	if len(all_data) < 2:
		print("只有不到两个有效的本地化文件，跳过内容同步。")
	else:
		for iteration in range(1, MAX_SYNC_ITERATIONS + 1):
			print(f"\n--- 同步迭代轮次 {iteration}/{MAX_SYNC_ITERATIONS} (locales) ---")
			made_changes_in_iteration = False
			sorted_file_paths = sorted(list(all_data.keys()))
			path_pairs = []
			if ref_path and ref_path in sorted_file_paths:
				other_paths = [p for p in sorted_file_paths if p != ref_path]
				path_pairs.extend([(ref_path, other_p) for other_p in other_paths])
				for i in range(len(other_paths)):
					for j in range(i + 1, len(other_paths)):
						path_pairs.append((other_paths[i], other_paths[j]))
			else:
				for i in range(len(sorted_file_paths)):
					for j in range(i + 1, len(sorted_file_paths)):
						path_pairs.append((sorted_file_paths[i], sorted_file_paths[j]))

			for p_a, p_b in path_pairs:
				lang_a, lang_b = languages[p_a], languages[p_b]
				# print(f"\n  比较: {lang_a} ({os.path.basename(p_a)}) <-> {lang_b} ({os.path.basename(p_b)})")
				if normalize_and_sync_dicts(all_data[p_a], all_data[p_b], lang_a, lang_b, all_data, languages, REFERENCE_LANG_CODES):
					made_changes_in_iteration = True

			if not made_changes_in_iteration:
				print("\n内容同步完成 (locales)，本轮无更改。")
				break
			elif iteration == MAX_SYNC_ITERATIONS:
				print("\n警告：达到最大同步迭代次数 (locales)，内容同步可能未完全收敛。")
			else:
				print(f"\n第 {iteration} 轮同步检测到更改 (locales)，可能需要下一轮...")

	print("\n--- 开始全局占位符对齐检查 ---")
	placeholder_changes_made = perform_global_placeholder_alignment(all_data, languages, REFERENCE_LANG_CODES)
	if placeholder_changes_made:
		print("  占位符对齐过程进行了一些更改。如果任何翻译被清空，它们可能需要在后续重新翻译。")

	if ref_path not in all_data:
		print(f"\n错误: 参考文件 '{os.path.basename(ref_path)}' 在处理过程中似乎丢失，无法进行最终排序。")
		if all_data:
			new_ref_path_candidate = next(iter(all_data.keys()))
			print(f"尝试使用文件 '{os.path.basename(new_ref_path_candidate)}' ({languages.get(new_ref_path_candidate, '未知')}) 作为新的排序参考。")
			ref_path = new_ref_path_candidate
		else:
			print("没有文件数据剩余，跳过排序和保存 (locales)。")
			if lang_to_path:
				process_home_registries(lang_to_path, REFERENCE_LANG_CODES, all_data)
			sys.exit(1)

	print(f"\n开始根据参考文件 '{os.path.basename(ref_path)}' ({languages.get(ref_path, '未知')}) 对所有 locale 文件进行排序...")
	final_reference_data_for_sorting = all_data[ref_path]
	for filepath_to_sort, data_to_sort in all_data.items():
		all_data[filepath_to_sort] = reorder_keys_like_reference(data_to_sort, final_reference_data_for_sorting)

	print("\n保存所有更新和排序后的 locale 文件...")
	for filepath_to_save, ordered_data_to_save in sorted(all_data.items()):
		try:
			with open(filepath_to_save, "w", encoding="utf-8", newline="\n") as f:
				json.dump(ordered_data_to_save, f, ensure_ascii=False, indent="\t", default=str)
				f.write("\n")
			print(f"  - 已保存: {os.path.basename(filepath_to_save)}")
		except Exception as e:
			print(f"  - 错误: 保存 {os.path.basename(filepath_to_save)} 时出错: {e}")

	if lang_to_path:
		process_home_registries(lang_to_path, REFERENCE_LANG_CODES, all_data)
	else:
		print("\n警告: 没有加载有效的区域设置，跳过 home_registry.json 的处理。")

	print("\n脚本执行完毕。")


if __name__ == "__main__":
	main()
