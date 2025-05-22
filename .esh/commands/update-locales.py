import json
import os
import copy
import re
from deep_translator import GoogleTranslator
import time
from collections import OrderedDict
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
FOUNT_DIR = os.path.join(MY_DIR, "../../")

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
# ----------- 配置结束 -----------

# 获取Google支持的语言代码字典和代码集合
try:
	_supp_lang_translator = GoogleTranslator(source="auto", target="en")  # 临时实例
	SUPPORTED_GOOGLE_LANGS_DICT = _supp_lang_translator.get_supported_languages(
		as_dict=True
	)
	SUPPORTED_GOOGLE_CODES = set(SUPPORTED_GOOGLE_LANGS_DICT.values())
	print(f"成功加载 Google Translator 支持的语言 ({len(SUPPORTED_GOOGLE_CODES)} 种)。")
except Exception as e:
	print(f"错误: 初始化 Google Translator 失败，无法获取支持语言列表: {e}")
	print("翻译功能将无法正常工作。请检查网络连接或 deep_translator 库。")
	# 设置为None或空集合，避免后续检查报错
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
			# 使用 .get() 避免 KeyError，并检查是否仍然是字典/OrderedDict
			if isinstance(current_level, (OrderedDict, dict)):
				current_level = current_level.get(key)
				if current_level is None:  # 如果 key 不存在
					return None, False
			else:  # 如果中间路径不是字典，路径无效
				return None, False
		return current_level, True
	except Exception:  # 捕获其他可能的异常，如TypeError
		return None, False


def find_best_translation_source(key_path, all_data, languages_map, reference_codes):
	"""根据参考语言优先级查找最佳翻译源。返回 (值, 源语言代码) 或 (None, None)。"""
	# 1. 尝试参考语言
	for ref_lang in reference_codes:
		# 查找参考语言对应的文件路径
		path = next((p for p, lang in languages_map.items() if lang == ref_lang), None)
		if path and path in all_data:
			value, found = get_value_at_path(all_data[path], key_path)
			if found:
				if isinstance(value, str) and value.strip() == "":
					continue
				if (
					isinstance(value, OrderedDict)
					and len(value) == 1
					and "text" in value
					and value["text"].strip() == ""
				):
					continue
				return value, ref_lang
	# 2. 尝试其他任何语言
	for path, data in all_data.items():
		lang = languages_map.get(path)
		if lang and lang not in reference_codes:
			value, found = get_value_at_path(data, key_path)
			if found:
				if isinstance(value, str) and value.strip() == "":
					continue
				if (
					isinstance(value, OrderedDict)
					and len(value) == 1
					and "text" in value
					and value["text"].strip() == ""
				):
					continue
				return value, lang
	print(f"    - 警告: 无法在任何文件中找到键 '{key_path}' 的有效非空源值。")
	return None, None


def align_placeholders(original_text: str, translated_text: str) -> str:
	"""
	Aligns placeholders in the translated string based on the original text string.
	1. Normalizes "$  {" to "${" in translated_text.
	2. Replaces placeholders in translated_text sequentially with those from original_text.
	"""
	if not isinstance(translated_text, str):
		return translated_text

	normalized_translated = re.sub(r"\$\s*\{", "${", translated_text)
	text_placeholders_content = re.findall(r"\$\{(.*?)\}", original_text)

	if not text_placeholders_content:
		return normalized_translated

	text_content_iter = iter(text_placeholders_content)

	def replace_with_text_placeholder(match_obj):
		try:
			new_content = next(text_content_iter)
			return f"${{{new_content}}}"
		except StopIteration:
			return match_obj.group(0)

	final_translated = re.sub(
		r"\$\{(.*?)\}", replace_with_text_placeholder, normalized_translated
	)
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

	src_code = get_compatible_code(source_lang)
	tgt_code = get_compatible_code(target_lang)

	if src_code is None:
		print(f"    - 错误: 源语言代码 '{source_lang}' 不被 Google Translator 支持。")
		return ""
	if tgt_code is None:
		print(f"    - 错误: 目标语言代码 '{target_lang}' 不被 Google Translator 支持。")
		return ""

	if src_code == tgt_code:
		return text

	print(
		f"    - 正在翻译: '{text[:50]}{'...' if len(text) > 50 else ''}' 从 {source_lang}({src_code}) 到 {target_lang}({tgt_code})"
	)
	time.sleep(TRANSLATION_DELAY)

	try:
		translator = GoogleTranslator(source=src_code, target=tgt_code)
		translated_result = translator.translate(text)
		if translated_result is not None:
			aligned_translated = align_placeholders(text, translated_result)
			print(f"      - 翻译成功 (对齐后): '{aligned_translated[:50]}{'...' if len(aligned_translated) > 50 else ''}'")
			return aligned_translated
		else:
			raise ValueError("Translator returned None")
	except Exception as e:
		print(f"    - 翻译 '{text[:50]}...' ({src_code} -> {tgt_code}) 初始失败: {e}")
		# (重试逻辑保持不变)
		s_base = src_code.split("-")[0]
		t_lower = tgt_code.lower()
		t_base = tgt_code.split("-")[0]
		t_variant = ""
		if "-" in tgt_code:
			parts = tgt_code.split("-")
			if len(parts) == 2:
				t_variant = f"{parts[0].lower()}-{parts[1].upper()}"

		attempts = [
			(src_code, t_lower),
			(src_code, t_variant),
			(src_code, t_base),
			(s_base, tgt_code),
			(s_base, t_lower),
			(s_base, t_variant),
			(s_base, t_base),
		]
		unique_attempts = []
		seen = set([(src_code, tgt_code)])
		for s, t in attempts:
			s_try_code = get_compatible_code(s)
			t_try_code = get_compatible_code(t)
			if (
				s_try_code
				and t_try_code
				and s_try_code != t_try_code
				and (s_try_code, t_try_code) not in seen
			):
				unique_attempts.append((s_try_code, t_try_code))
				seen.add((s_try_code, t_try_code))

		for s_try, t_try in unique_attempts:
			try:
				print(f"      - 尝试备选: source={s_try}, target={t_try}")
				time.sleep(TRANSLATION_DELAY)
				translator = GoogleTranslator(source=s_try, target=t_try)
				translated_result_retry = translator.translate(text)
				if translated_result_retry is not None:
					aligned_translated_retry = align_placeholders(
						text, translated_result_retry
					)
					print(f"      - 备选翻译成功 (对齐后): '{aligned_translated_retry[:50]}{'...' if len(aligned_translated_retry) > 50 else ''}'")
					return aligned_translated_retry
			except Exception as e2:
				print(f"      - 尝试 {s_try} -> {t_try} 失败: {e2}")

		print(
			f"    - 翻译 '{text[:50]}...' ({src_code} -> {tgt_code}) 所有尝试均失败。返回空字符串。"
		)
		return ""


def translate_value(value, source_lang, target_lang):
	"""递归地翻译值（字符串、列表或 OrderedDict）"""
	if isinstance(value, str):
		return translate_text(value, source_lang, target_lang)
	elif isinstance(value, OrderedDict):
		translated_dict = OrderedDict()
		for k, v in value.items():
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
	keys_a_set = set(dict_a.keys())
	keys_b_set = set(dict_b.keys())
	all_keys = list(dict_a.keys()) + [k for k in dict_b.keys() if k not in keys_a_set]

	if path == "":
		lang_key = "lang"
		if lang_key in dict_a and dict_a[lang_key] != lang_a:
			dict_a[lang_key] = lang_a
			changed = True
		elif lang_key not in dict_a:
			dict_a[lang_key] = lang_a
			changed = True
		if lang_key in dict_b and dict_b[lang_key] != lang_b:
			dict_b[lang_key] = lang_b
			changed = True
		elif lang_key not in dict_b:
			dict_b[lang_key] = lang_b
			changed = True
		if lang_key in all_keys:
			all_keys.remove(lang_key)
		all_keys.insert(0, lang_key)

	for key in all_keys:
		current_path = f"{path}.{key}" if path else key
		in_a, in_b = key in dict_a, key in dict_b
		if path == "" and key == "lang":
			if in_a and in_b:
				continue
		if (in_a and not in_b) or (not in_a and in_b):
			continue
		if in_a and in_b:
			val_a, val_b = dict_a[key], dict_b[key]
			type_a, type_b = type(val_a), type(val_b)
			standardized = False
			if type_a == str and type_b == OrderedDict:
				dict_a[key] = OrderedDict([("text", val_a)])
				changed = standardized = True
			elif type_a == OrderedDict and type_b == str:
				dict_b[key] = OrderedDict([("text", val_b)])
				changed = standardized = True
			val_a_std, val_b_std = dict_a[key], dict_b[key]
			type_a_std, type_b_std = type(val_a_std), type(val_b_std)
			if type_a_std == OrderedDict and type_b_std == OrderedDict:
				if normalize_and_sync_dicts(
					val_a_std,
					val_b_std,
					lang_a,
					lang_b,
					all_data_global,
					languages_global,
					reference_codes_global,
					current_path,
				):
					changed = True
			elif type_a_std != type_b_std and not standardized:
				print(
					f"  - 警告: 类型不匹配 @ '{current_path}'. {lang_a}: {type_a_std.__name__}, {lang_b}: {type_b_std.__name__}. 跳过递归。"
				)

	for key in all_keys:
		current_path = f"{path}.{key}" if path else key
		in_a, in_b = key in dict_a, key in dict_b
		if path == "" and key == "lang" and in_a and in_b:
			continue
		if not in_a or not in_b:
			target_dict, target_lang, missing_in = (
				(dict_a, lang_a, lang_a) if not in_a else (dict_b, lang_b, lang_b)
			)
			if path == "" and key == "lang":  # Should be handled above
				if not in_a:
					dict_a[key] = lang_a
					changed = True
				if not in_b:
					dict_b[key] = lang_b
					changed = True
				continue
			source_value, source_lang = find_best_translation_source(
				current_path, all_data_global, languages_global, reference_codes_global
			)
			if source_value is not None and source_lang is not None:
				ref_value = dict_a.get(key) if key in dict_a else dict_b.get(key)
				source_value_processed = copy.deepcopy(source_value)
				if ref_value is not None and type(source_value_processed) != type(
					ref_value
				):
					if (
						isinstance(ref_value, OrderedDict)
						and "text" in ref_value
						and isinstance(source_value_processed, str)
					):
						source_value_processed = OrderedDict(
							[("text", source_value_processed)]
						)
					elif (
						isinstance(ref_value, str)
						and isinstance(source_value_processed, OrderedDict)
						and "text" in source_value_processed
						and len(source_value_processed) == 1
					):
						source_value_processed = source_value_processed["text"]
				translated_val = translate_value(
					source_value_processed, source_lang, target_lang
				)
				target_dict[key] = translated_val
				changed = True
			else:
				print(
					f"  - 无法为 '{current_path}' 找到翻译源，跳过添加到 {missing_in}。"
				)
	return changed


def reorder_keys_like_reference(target_dict, reference_dict):
	if not isinstance(target_dict, OrderedDict) or not isinstance(
		reference_dict, OrderedDict
	):
		return target_dict
	ordered_target = OrderedDict()
	ref_keys = set(reference_dict.keys())
	for key, ref_value in reference_dict.items():
		if key in target_dict:
			value = target_dict[key]
			if isinstance(value, OrderedDict) and isinstance(ref_value, OrderedDict):
				ordered_target[key] = reorder_keys_like_reference(value, ref_value)
			else:
				ordered_target[key] = value
	extra_keys = [key for key in target_dict.keys() if key not in ref_keys]
	for key in extra_keys:
		ordered_target[key] = target_dict[key]
	return ordered_target


def process_home_registries(map_lang_to_path, global_ref_lang_codes):
	"""
	Processes all home_registry.json files in FOUNT_DIR.
	- Deletes language entries from 'info' if the lang is not in loaded locales.
	- Translates and adds missing languages to 'info' if the lang is in loaded locales.
	- Reorders 'info' keys.
	"""
	if not os.path.isdir(FOUNT_DIR):
		print(f"警告: Fount 目录 '{FOUNT_DIR}' 不存在，跳过 home_registry.json 处理。")
		return

	available_locale_langs = set(map_lang_to_path.keys())
	if not available_locale_langs:
		print("警告: 没有加载任何有效的区域设置语言，无法处理 home_registry.json。")
		return

	print(f"\n--- 开始处理 Fount 目录 '{FOUNT_DIR}' 下的 home_registry.json 文件 ---")
	print(
		f"可用的区域语言 (来自 locales): {', '.join(sorted(list(available_locale_langs)))}"
	)

	registry_keys_to_process = ["home_function_buttons", "home_char_interfaces"]

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

				for reg_key in registry_keys_to_process:
					if reg_key in registry_data and isinstance(
						registry_data[reg_key], list
					):
						print(f"  检查列表: '{reg_key}'")
						for item_index, item_obj in enumerate(registry_data[reg_key]):
							if "info" in item_obj and isinstance(
								item_obj["info"], (dict, OrderedDict)
							):
								current_info_dict = item_obj["info"]
								# Ensure current_info_dict is OrderedDict for consistent processing
								if not isinstance(current_info_dict, OrderedDict):
									current_info_dict = OrderedDict(
										current_info_dict.items()
									)

								original_info_dict_for_comparison = copy.deepcopy(
									current_info_dict
								)
								item_description = f"'{reg_key}' 项目 {item_index}"

								# 1. Deletion
								langs_in_info_original = list(current_info_dict.keys())
								for lang_code in langs_in_info_original:
									if lang_code not in available_locale_langs:
										print(
											f"    - 从 {item_description} 的 info 中删除 '{lang_code}' (在 locales 中不存在)"
										)
										del current_info_dict[lang_code]

								# 2. Addition/Translation
								present_info_langs_after_delete = set(
									current_info_dict.keys()
								)
								langs_to_add_to_info = (
									available_locale_langs
									- present_info_langs_after_delete
								)

								if langs_to_add_to_info:
									if not present_info_langs_after_delete:
										print(
											f"    - 警告: {item_description} 的 info 为空，无法为 '{', '.join(langs_to_add_to_info)}' 添加翻译。"
										)
									else:
										source_lang_in_info = None
										source_data_from_info = None
										for r_lang_code in global_ref_lang_codes:
											if (
												r_lang_code
												in present_info_langs_after_delete
											):
												source_lang_in_info = r_lang_code
												source_data_from_info = (
													current_info_dict[r_lang_code]
												)
												break
										if (
											not source_lang_in_info
											and present_info_langs_after_delete
										):
											source_lang_in_info = next(
												iter(present_info_langs_after_delete)
											)  # Fallback
											source_data_from_info = current_info_dict[
												source_lang_in_info
											]

										if source_lang_in_info and isinstance(
											source_data_from_info, (dict, OrderedDict)
										):
											print(
												f"    - 为 {item_description} 的 info 翻译缺失语言，源: '{source_lang_in_info}'"
											)
											for (
												target_lang_to_add
											) in langs_to_add_to_info:
												print(
													f"      - 翻译到 '{target_lang_to_add}'..."
												)
												translated_item_content = OrderedDict()
												for (
													text_key,
													text_to_translate,
												) in source_data_from_info.items():
													if isinstance(
														text_to_translate, str
													):
														translated_text = (
															translate_text(
																text_to_translate,
																source_lang_in_info,
																target_lang_to_add,
															)
														)
														translated_item_content[
															text_key
														] = translated_text
													else:
														print(
															f"      - 警告: {item_description} 中 '{text_key}' 的值不是字符串 (源 '{source_lang_in_info}'). 复制原值 '{text_to_translate}' 到 '{target_lang_to_add}'."
														)
														translated_item_content[
															text_key
														] = copy.deepcopy(
															text_to_translate
														)
												if translated_item_content:
													current_info_dict[
														target_lang_to_add
													] = translated_item_content
										elif (
											source_lang_in_info
										):  # but source_data_from_info was not a dict
											print(
												f"    - 警告: {item_description} 中源语言 '{source_lang_in_info}' 的数据不是字典类型。跳过翻译。"
											)
										else:  # No source lang found (should not happen if present_info_langs_after_delete is not empty)
											print(
												f"    - 警告: {item_description} 的 info 中找不到合适的源语言进行翻译。"
											)

								# 3. Reorder keys in current_info_dict and check for changes
								final_ordered_info_dict = OrderedDict()
								for r_lang in global_ref_lang_codes:
									if r_lang in current_info_dict:
										final_ordered_info_dict[r_lang] = (
											current_info_dict[r_lang]
										)
								for lang_code_key in sorted(current_info_dict.keys()):
									if lang_code_key not in final_ordered_info_dict:
										final_ordered_info_dict[lang_code_key] = (
											current_info_dict[lang_code_key]
										)

								if (
									final_ordered_info_dict
									!= original_info_dict_for_comparison
								):
									item_obj["info"] = final_ordered_info_dict
									file_changed_overall = True
									if (
										final_ordered_info_dict != current_info_dict
									):  # If order changed but content might be same
										print(
											f"    - {item_description} 的 info 键已重新排序。"
										)
								else:  # No change in content or order compared to original
									item_obj["info"] = (
										original_info_dict_for_comparison  # Revert to original if no effective change
									)

				if file_changed_overall:
					print(f"  保存已修改的文件: {filepath}")
					try:
						with open(filepath, "w", encoding="utf-8", newline="\n") as f:
							json.dump(
								registry_data,
								f,
								ensure_ascii=False,
								indent="\t",
								default=str,
							)
							f.write("\n")
					except Exception as e:
						print(f"  错误: 保存 {filepath} 时出错: {e}")
				else:
					print(f"  文件 {filepath} 无需更改。")
	print(f"--- Fount 目录处理完毕 ---")


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
				lang_to_path[lang] = filepath
				print(f"  - 已加载: {filename} ({lang})")
		except json.JSONDecodeError as e:
			print(f"  - 错误: 解析 {filename} 时出错: {e}. 请检查 JSON 格式。跳过。")
		except Exception as e:
			print(f"  - 错误: 加载 {filename} 时发生未知错误: {e}. 跳过。")

	if len(all_data) < 1:
		print("未找到有效的本地化文件。")
		sys.exit(1)

	ref_path, ref_lang = None, None
	for lang_code in REFERENCE_LANG_CODES:
		if lang_code in lang_to_path:
			ref_path = lang_to_path[lang_code]
			ref_lang = lang_code
			print(f"\n找到优先参考语言文件: {os.path.basename(ref_path)} ({ref_lang})")
			break
	if not ref_path:
		ref_path = next(iter(all_data.keys()))
		ref_lang = languages[ref_path]
		print(
			f"\n警告: 未找到配置的参考语言。使用加载的第一个文件 '{os.path.basename(ref_path)}' ({ref_lang}) 作为参考。"
		)

	print("\n开始同步内容和结构 (locales)...")
	current_file_paths = list(all_data.keys())
	if len(current_file_paths) < 2:
		print("只有不到两个有效的本地化文件，跳过内容同步。")
	else:
		for iteration in range(1, MAX_SYNC_ITERATIONS + 1):
			print(f"\n--- 同步迭代轮次 {iteration}/{MAX_SYNC_ITERATIONS} (locales) ---")
			made_changes_in_iteration = False
			file_paths_in_iteration = list(all_data.keys())
			for i in range(len(file_paths_in_iteration)):
				for j in range(i + 1, len(file_paths_in_iteration)):
					path_a, path_b = (
						file_paths_in_iteration[i],
						file_paths_in_iteration[j],
					)
					lang_a, lang_b = languages[path_a], languages[path_b]
					# print(f"\n比较: {lang_a} ({os.path.basename(path_a)}) <-> {lang_b} ({os.path.basename(path_b)})")
					data_a_copy = copy.deepcopy(all_data[path_a])
					data_b_copy = copy.deepcopy(all_data[path_b])
					if normalize_and_sync_dicts(
						data_a_copy,
						data_b_copy,
						lang_a,
						lang_b,
						all_data,
						languages,
						REFERENCE_LANG_CODES,
					):
						if data_a_copy != all_data[path_a]:
							all_data[path_a] = data_a_copy
							made_changes_in_iteration = True
						if data_b_copy != all_data[path_b]:
							all_data[path_b] = data_b_copy
							made_changes_in_iteration = True
			if not made_changes_in_iteration:
				print("\n内容同步完成 (locales)，本轮无更改。")
				break
			elif iteration == MAX_SYNC_ITERATIONS:
				print(
					"\n警告：达到最大同步迭代次数 (locales)，内容同步可能未完全收敛。"
				)
			else:
				print(f"\n第 {iteration} 轮同步检测到更改 (locales)，继续下一轮...")

	if ref_path not in all_data:
		print(
			f"\n错误: 参考文件 '{os.path.basename(ref_path)}' 在同步过程中丢失，无法进行排序。"
		)
		if all_data:
			new_ref_path = next(iter(all_data.keys()))
			print(
				f"尝试使用文件 '{os.path.basename(new_ref_path)}' ({languages[new_ref_path]}) 作为新的排序参考。"
			)
			ref_path = new_ref_path
		else:
			print("没有文件剩余，跳过排序和保存 (locales)。")
			# Call new function even if locales saving is skipped, if lang_to_path is populated
			process_home_registries(lang_to_path, REFERENCE_LANG_CODES)
			sys.exit(1)

	print(
		f"\n开始根据参考文件 '{os.path.basename(ref_path)}' ({languages[ref_path]}) 对所有 locale 文件进行排序..."
	)
	final_ordered_data = OrderedDict()
	ref_data_final = all_data[ref_path]
	for filepath_iter in all_data.keys():
		data = all_data[filepath_iter]
		# print(f"  - 排序文件: {os.path.basename(filepath_iter)} ({languages[filepath_iter]})")
		final_ordered_data[filepath_iter] = reorder_keys_like_reference(
			data, ref_data_final
		)

	print("\n保存所有更新和排序后的 locale 文件...")
	for filepath_iter in sorted(final_ordered_data.keys()):
		data = final_ordered_data[filepath_iter]
		try:
			with open(filepath_iter, "w", encoding="utf-8", newline="\n") as f:
				json.dump(data, f, ensure_ascii=False, indent="\t", default=str)
				f.write("\n")
			print(f"  - 已保存: {os.path.basename(filepath_iter)}")
		except Exception as e:
			print(f"  - 错误: 保存 {os.path.basename(filepath_iter)} 时出错: {e}")

	# --- 新增功能调用 ---
	# lang_to_path 包含所有成功加载的 locale 语言及其文件路径
	# REFERENCE_LANG_CODES 是全局配置的参考语言
	process_home_registries(lang_to_path, REFERENCE_LANG_CODES)
	# --- 新增功能调用结束 ---

	print("\n脚本执行完毕。")


if __name__ == "__main__":
	main()
