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
				# 检查找到的值是否为空字符串，如果是，尝试下一个源
				if isinstance(value, str) and value.strip() == "":
					# print(f"    - 警告: 找到键 '{key_path}' 在 {ref_lang} 中的值为空，尝试下一个源。")
					continue  # 跳过空值源
				# 检查找到的值是否是 { "text": "" }，如果是，尝试下一个源
				if (
					isinstance(value, OrderedDict)
					and len(value) == 1
					and "text" in value
					and value["text"].strip() == ""
				):
					# print(f"    - 警告: 找到键 '{key_path}' 在 {ref_lang} 中的值是空对象 {'{"text": ""}'}，尝试下一个源。")
					continue  # 跳过空值源
				return value, ref_lang
	# 2. 尝试其他任何语言
	for path, data in all_data.items():
		lang = languages_map.get(path)
		# 排除已经尝试过的参考语言
		if lang and lang not in reference_codes:
			value, found = get_value_at_path(data, key_path)
			if found:
				# 检查找到的值是否为空字符串或 { "text": "" }，如果是，尝试下一个源
				if isinstance(value, str) and value.strip() == "":
					continue  # 跳过空值源
				if (
					isinstance(value, OrderedDict)
					and len(value) == 1
					and "text" in value
					and value["text"].strip() == ""
				):
					continue  # 跳过空值源
				return value, lang
	# 3. 未找到有效的非空值
	print(f"    - 警告: 无法在任何文件中找到键 '{key_path}' 的有效非空源值。")
	return None, None


def align_placeholders(original_text: str, translated_text: str) -> str:
	"""
	Aligns placeholders in the translated string based on the original text string.
	1. Normalizes "$  {" to "${" in translated_text.
	2. Replaces placeholders in translated_text sequentially with those from original_text.
	"""
	if not isinstance(translated_text, str):  # 防御性编程，如果翻译结果不是字符串
		return translated_text

	# 1. 将translated中所有的`\$\s+\{`替换到`${`
	normalized_translated = re.sub(r"\$\s*\{", "${", translated_text)

	# 2. 提取original_text中的所有placeholder内容 (XXX)
	text_placeholders_content = re.findall(r"\$\{(.*?)\}", original_text)

	if not text_placeholders_content:
		# 如果原始文本中没有placeholder，直接返回初步normalize后的translated
		# 或许还需要处理 translated 中的 " }" -> "}"，但主要问题是 "$ {"
		# 为了简化，我们假设如果原始文本没有占位符，翻译后的文本中的占位符格式我们不强制更改
		# 除了开头的 "$ {"。如果需要进一步规范化，如内部空格，可以添加。
		# 但如果原始文本没有占位符，对齐步骤本身就没有意义。
		# 不过，为了确保 "$ {foo}" 变成 "${foo}" 即使原始文本没有占位符，
		# 这一步的 normalized_translated 还是有用的。
		return normalized_translated

	text_content_iter = iter(text_placeholders_content)

	def replace_with_text_placeholder(match_obj):
		try:
			new_content = next(text_content_iter)
			return f"${{{new_content}}}"
		except StopIteration:
			# 如果原始文本的placeholder用完了，但翻译文本中还有
			# 保留翻译文本中的placeholder（在它被第一步normalize之后）
			return match_obj.group(0)

	final_translated = re.sub(
		r"\$\{(.*?)\}", replace_with_text_placeholder, normalized_translated
	)
	return final_translated


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
	"""翻译文本，包含重试逻辑、延时，并在翻译成功后对齐占位符。"""
	if not isinstance(text, str) or not text or source_lang == target_lang:
		return text

	# 辅助函数：将语言代码转换为Google支持的形式
	def get_compatible_code(code):
		if not SUPPORTED_GOOGLE_CODES:  # 如果初始化Google Translator失败
			return code  # 无法检查，只能原样返回

		if code in SUPPORTED_GOOGLE_CODES:
			return code
		# 尝试处理 zh-CN -> zh 之类的
		base_code = code.split("-")[0]
		if base_code in SUPPORTED_GOOGLE_CODES:
			return base_code
		# 尝试大小写匹配
		code_lower = code.lower()
		for sc in SUPPORTED_GOOGLE_CODES:
			if sc.lower() == code_lower:
				return sc
		base_lower = base_code.lower()
		for sc in SUPPORTED_GOOGLE_CODES:
			if sc.lower() == base_lower:
				return sc
		return None  # 未找到兼容代码

	src_code = get_compatible_code(source_lang)
	tgt_code = get_compatible_code(target_lang)

	if src_code is None:
		print(f"    - 错误: 源语言代码 '{source_lang}' 不被 Google Translator 支持。")
		return ""  # 翻译失败，返回空
	if tgt_code is None:
		print(f"    - 错误: 目标语言代码 '{target_lang}' 不被 Google Translator 支持。")
		return ""  # 翻译失败，返回空

	if src_code == tgt_code:
		return text  # 源语言和目标语言兼容代码相同，无需翻译

	print(
		f"    - 正在翻译: '{text[:50]}{'...' if len(text) > 50 else ''}' 从 {source_lang}({src_code}) 到 {target_lang}({tgt_code})"
	)
	time.sleep(TRANSLATION_DELAY)

	translated_result = None  # 用于存储翻译结果

	try:
		translator = GoogleTranslator(source=src_code, target=tgt_code)
		translated_result = translator.translate(text)
		if translated_result is not None:
			print(
				f"      - 翻译成功 (原始): '{translated_result[:50]}{'...' if len(translated_result) > 50 else ''}'"
			)
			aligned_translated = align_placeholders(text, translated_result)
			print(
				f"      - 翻译成功 (对齐后): '{aligned_translated[:50]}{'...' if len(aligned_translated) > 50 else ''}'"
			)
			return aligned_translated
		else:
			print(f"    - 翻译 '{text[:50]}...' ({src_code} -> {tgt_code}) 返回 None。")
			raise ValueError("Translator returned None")
	except Exception as e:
		print(f"    - 翻译 '{text[:50]}...' ({src_code} -> {tgt_code}) 初始失败: {e}")

		# 尝试备选的语言代码组合进行重试
		s_base = src_code.split("-")[0]
		t_lower = tgt_code.lower()
		t_base = tgt_code.split("-")[0]
		# 尝试常用的非标准格式，如 zh-cn, en-us/en-US 等
		t_variant = ""
		if "-" in tgt_code:
			parts = tgt_code.split("-")
			if len(parts) == 2:
				t_variant = f"{parts[0].lower()}-{parts[1].upper()}"

		attempts = [
			(src_code, t_lower),  # 目标语言小写
			(src_code, t_variant),  # 目标语言带规范化地区码 (zh-CN -> zh-CN)
			(src_code, t_base),  # 目标语言基础代码 (zh-CN -> zh)
			(s_base, tgt_code),  # 源语言基础代码 (zh-CN -> zh), 目标语言原样
			(s_base, t_lower),  # 源语言基础代码，目标语言小写
			(s_base, t_variant),  # 源语言基础代码，目标语言规范化地区码
			(s_base, t_base),  # 源语言基础代码，目标语言基础代码
		]

		unique_attempts = []
		# 记录已尝试过的组合，避免重复
		seen = set([(src_code, tgt_code)])
		for s, t in attempts:
			s_try_code = get_compatible_code(s)
			t_try_code = get_compatible_code(t)
			# 确保备选代码有效且源和目标不同，且组合未尝试过
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
					print(
						f"      - 备选翻译成功 (原始): '{translated_result_retry[:50]}{'...' if len(translated_result_retry) > 50 else ''}'"
					)
					aligned_translated_retry = align_placeholders(
						text, translated_result_retry
					)
					print(
						f"      - 备选翻译成功 (对齐后): '{aligned_translated_retry[:50]}{'...' if len(aligned_translated_retry) > 50 else ''}'"
					)
					return aligned_translated_retry
			except Exception as e2:
				print(f"      - 尝试 {s_try} -> {t_try} 失败: {e2}")

		print(
			f"    - 翻译 '{text[:50]}...' ({src_code} -> {tgt_code}) 所有尝试均失败。"
		)
		print(f"    - 根据配置，翻译失败的键将设置为 '\"\"'。")
		return ""


def translate_value(value, source_lang, target_lang):
	"""递归地翻译值（字符串、列表或 OrderedDict）"""
	if isinstance(value, str):
		return translate_text(value, source_lang, target_lang)
	elif isinstance(value, OrderedDict):
		# 创建新的 OrderedDict 来存储翻译后的子项
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
	reference_codes,
	path="",
):
	"""
	递归地同步两个 OrderedDict (传入的应该是副本)。
	- 标准化 string vs dict{"text":...} 冲突。
	- 添加缺失的键（通过查找最佳源进行翻译）。
	- 处理根部的 'lang' 字段。
	返回一个布尔值，指示是否有更改发生。
	"""
	changed = False
	# 获取所有键的集合，保持原始 OrderedDict 的插入顺序（至少对于 dict_a）
	keys_a_set = set(dict_a.keys())
	keys_b_set = set(dict_b.keys())
	# 合并键列表，优先使用 dict_a 的顺序，然后是 dict_b 独有的
	all_keys = list(dict_a.keys()) + [k for k in dict_b.keys() if k not in keys_a_set]

	# 先处理根部的 'lang' 键
	if path == "":
		lang_key = "lang"
		in_a = lang_key in dict_a
		in_b = lang_key in dict_b

		# === 修改点 1: 处理根部 'lang' 字段 ===
		if in_a and dict_a[lang_key] != lang_a:
			print(
				f"  - 修正: 文件 {lang_a} 中根部 'lang' 值不匹配 ('{dict_a[lang_key]}' -> '{lang_a}')"
			)
			dict_a[lang_key] = lang_a
			changed = True
		elif not in_a:
			print(f"  - 添加: 文件 {lang_a} 中缺失根部 'lang' 键 ('{lang_a}')")
			dict_a[lang_key] = lang_a
			changed = True

		if in_b and dict_b[lang_key] != lang_b:
			print(
				f"  - 修正: 文件 {lang_b} 中根部 'lang' 值不匹配 ('{dict_b[lang_key]}' -> '{lang_b}')"
			)
			dict_b[lang_key] = lang_b
			changed = True
		elif not in_b:
			print(f"  - 添加: 文件 {lang_b} 中缺失根部 'lang' 键 ('{lang_b}')")
			dict_b[lang_key] = lang_b
			changed = True

		# 将 'lang' 键移到列表开头，以便后续处理时它位于首位
		if lang_key in all_keys:
			all_keys.remove(lang_key)
		all_keys.insert(0, lang_key)
		# === 修改点 1 结束 ===

	# 处理共有的键和结构标准化，以及递归处理子项
	for key in all_keys:
		current_path = f"{path}.{key}" if path else key
		in_a = key in dict_a
		in_b = key in dict_b

		# 跳过已经在上面特殊处理过的根部 'lang' 键，除非它仍然缺失需要添加（尽管上面已经处理过了）
		if path == "" and key == "lang":
			if in_a and in_b:  # 如果都存在且已处理，则跳过后续的泛型处理
				continue

		# 如果键只存在于一方，先跳过，等后面统一处理缺失键
		if (in_a and not in_b) or (not in_a and in_b):
			continue

		# 如果键在两边都存在，处理结构标准化和递归
		if in_a and in_b:
			val_a, val_b = dict_a[key], dict_b[key]
			type_a, type_b = type(val_a), type(val_b)

			# --- 结构标准化 (倾向于 OrderedDict) ---
			standardized = False
			if type_a == str and type_b == OrderedDict:
				print(f"  - 标准化(str->dict): 文件 {lang_a} @ '{current_path}'")
				dict_a[key] = OrderedDict([("text", val_a)])
				changed = standardized = True
			elif type_a == OrderedDict and type_b == str:
				print(f"  - 标准化(str->dict): 文件 {lang_b} @ '{current_path}'")
				dict_b[key] = OrderedDict([("text", val_b)])
				changed = standardized = True

			# 获取标准化后的值和类型
			val_a_std, val_b_std = dict_a[key], dict_b[key]
			type_a_std, type_b_std = type(val_a_std), type(val_b_std)

			# --- 递归或类型检查 ---
			if type_a_std == OrderedDict and type_b_std == OrderedDict:
				if normalize_and_sync_dicts(
					val_a_std,
					val_b_std,
					lang_a,
					lang_b,
					all_data_global,
					languages_global,
					reference_codes,
					current_path,
				):
					changed = True
			elif type_a_std != type_b_std and not standardized:  # 标准化后类型仍不匹配
				print(
					f"  - 警告: 类型不匹配 @ '{current_path}'. {lang_a}: {type_a_std.__name__}, {lang_b}: {type_b_std.__name__}. 跳过递归。"
				)
			# 如果类型相同且不是 dict，则不递归，也不标准化（比如都是字符串、列表、数字等，让翻译处理）

	# 最后处理缺失的键 (现在all_keys包含所有键)
	for key in all_keys:
		current_path = f"{path}.{key}" if path else key
		in_a = key in dict_a
		in_b = key in dict_b

		# 如果键是根部的 'lang' 且在上面已经被处理了（即不再缺失），跳过
		if path == "" and key == "lang" and in_a and in_b:
			continue

		# 需要添加的情况 (A缺 或 B缺)
		if not in_a or not in_b:
			target_dict, target_lang = (
				(dict_a, lang_a) if not in_a else (dict_b, lang_b)
			)
			missing_in = lang_a if not in_a else lang_b

			# === 针对根部 'lang' 键的二次检查 (如果前面的特殊处理没有完全搞定的话) ===
			if path == "" and key == "lang":
				# 这部分理论上不应该被触发，因为根部的 'lang' 键缺失已经在上面处理了
				# 但作为安全检查，如果不知为何还没添加，这里确保它被添加
				if not in_a:
					print(
						f"  - (二次检查) 添加: 文件 {lang_a} 中缺失根部 'lang' 键 ('{lang_a}')"
					)
					dict_a[key] = lang_a
					changed = True
				if not in_b:
					print(
						f"  - (二次检查) 添加: 文件 {lang_b} 中缺失根部 'lang' 键 ('{lang_b}')"
					)
					dict_b[key] = lang_b
					changed = True
				continue  # 'lang' 键已处理，跳过后续的查找源和翻译逻辑
			# === 二次检查结束 ===

			print(f"  - 键缺失: '{current_path}' 在 {missing_in} 中。 查找源...")
			source_value, source_lang = find_best_translation_source(
				current_path, all_data_global, languages_global, reference_codes
			)

			if source_value is not None and source_lang is not None:
				# 尝试基于已知的值类型进行简单的结构匹配（如果源和目标语言不同）
				# 获取“对方”的值作为参考结构，优先使用 OrderedDict{"text":...} 结构作为参考
				ref_value_a = dict_a.get(key) if key in dict_a else None
				ref_value_b = dict_b.get(key) if key in dict_b else None
				# 选择一个非空的参考值
				ref_value = ref_value_a if ref_value_a is not None else ref_value_b

				source_value_processed = copy.deepcopy(
					source_value
				)  # 复制源值以免修改全局数据

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
						print(f"    - 将源值 ({source_lang}) 标准化为 dict 结构")
					elif (
						isinstance(ref_value, str)
						and isinstance(source_value_processed, OrderedDict)
						and "text" in source_value_processed
						and len(source_value_processed) == 1
					):
						# 如果参考是字符串，而源是简单的 {"text": "..."} 结构，则提取字符串
						# 注意：只有当 OrderedDict 只有 'text' 一个键时才这样做
						source_value_processed = source_value_processed["text"]
						print(f"    - 将源值 ({source_lang}) 标准化为 str 结构")

				print(
					f"  - 添加缺失键: '{current_path}' 到 {target_lang} (从 {source_lang} 翻译)"
				)
				# 翻译标准化或原始的源值
				translated_val = translate_value(
					source_value_processed, source_lang, target_lang
				)
				target_dict[key] = translated_val  # 添加到目标字典
				changed = True
			else:
				# 如果找不到翻译源，则根据策略决定是否添加空值
				# 当前策略是：如果找不到源，就不添加这个键
				# 如果希望添加空值，可以在这里修改
				# target_dict[key] = "" # 添加空字符串
				# changed = True # 如果添加了，也算更改
				print(
					f"  - 无法为 '{current_path}' 找到翻译源，跳过添加到 {missing_in}。"
				)

	return changed


def reorder_keys_like_reference(target_dict, reference_dict):
	"""递归地按 reference_dict 的键顺序重新排序 target_dict (必须是 OrderedDict)。"""
	# 如果目标不是 OrderedDict，或者参考不是，无法排序
	if not isinstance(target_dict, OrderedDict) or not isinstance(
		reference_dict, OrderedDict
	):
		# print(f"  - 注意: 类型不匹配，无法排序。目标: {type(target_dict).__name__}, 参考: {type(reference_dict).__name__}")
		return target_dict

	ordered_target = OrderedDict()
	ref_keys = set(reference_dict.keys())
	target_keys = set(target_dict.keys())

	# 1. 按参考顺序添加共有键
	for key, ref_value in reference_dict.items():
		if key in target_keys:  # 如果目标字典中存在这个键
			value = target_dict[key]
			# 如果当前值和参考值都是 OrderedDict，则递归排序
			if isinstance(value, OrderedDict) and isinstance(ref_value, OrderedDict):
				ordered_target[key] = reorder_keys_like_reference(value, ref_value)
			else:
				# 否则直接添加值
				ordered_target[key] = value

	# 2. 添加目标中有但参考中没有的键 (保持在目标字典中的相对顺序)
	# 遍历原始目标字典的键，找出参考中没有的
	extra_keys = [key for key in target_dict.keys() if key not in ref_keys]
	if extra_keys:
		# print(f"  - 注意: 目标字典存在参考中没有的键: {extra_keys}。将附加在末尾。")
		for key in extra_keys:
			ordered_target[key] = target_dict[key]

	return ordered_target


# --- 主逻辑 ---
def main():
	if not os.path.isdir(LOCALE_DIR):
		print(f"错误: 目录 '{LOCALE_DIR}' 不存在或不是有效目录。")
		print(f"脚本预期目录位置: {os.path.abspath(LOCALE_DIR)}")
		sys.exit(1)  # 退出脚本

	all_data = OrderedDict()
	languages = {}  # path -> lang
	lang_to_path = {}  # lang -> path

	print("加载本地化文件...")
	# 获取所有json文件并按字母顺序排序
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
				# 使用 object_pairs_hook=OrderedDict 保留键的顺序
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

	if len(all_data) < 1:  # 至少需要一个文件，即使是参考文件
		print("未找到有效的本地化文件。")
		sys.exit(1)

	# --- 寻找参考文件 ---
	ref_path, ref_lang = None, None
	for lang_code in REFERENCE_LANG_CODES:
		if lang_code in lang_to_path:
			ref_path = lang_to_path[lang_code]
			ref_lang = lang_code
			print(f"\n找到优先参考语言文件: {os.path.basename(ref_path)} ({ref_lang})")
			break
	if not ref_path:
		# 如果没有找到配置的参考语言，使用加载的第一个文件作为后备
		ref_path = next(iter(all_data.keys()))
		ref_lang = languages[ref_path]
		print(
			f"\n警告: 未找到配置的参考语言。使用加载的第一个文件 '{os.path.basename(ref_path)}' ({ref_lang}) 作为参考。"
		)

	# --- 同步迭代 ---
	print("\n开始同步内容和结构...")
	# 获取当前需要处理的文件路径列表（排除了加载失败的）
	current_file_paths = list(all_data.keys())

	if len(current_file_paths) < 2:
		print("只有不到两个有效的本地化文件，跳过内容同步。")
	else:
		for iteration in range(1, MAX_SYNC_ITERATIONS + 1):
			print(f"\n--- 同步迭代轮次 {iteration}/{MAX_SYNC_ITERATIONS} ---")
			made_changes = False
			# 在每次迭代开始时，使用当前的文件列表
			file_paths_in_iteration = list(all_data.keys())

			# 比较所有文件对
			# 注意：这里是 O(N^2) 的比较，当文件数量很多时可能较慢
			# 更高效的方式可能是只比较所有文件与参考文件
			# 但目前的逻辑是两两比较，可以互相补充缺失的键
			for i in range(len(file_paths_in_iteration)):
				for j in range(i + 1, len(file_paths_in_iteration)):
					path_a, path_b = (
						file_paths_in_iteration[i],
						file_paths_in_iteration[j],
					)
					lang_a, lang_b = languages[path_a], languages[path_b]

					print(
						f"\n比较: {lang_a} ({os.path.basename(path_a)}) <-> {lang_b} ({os.path.basename(path_b)})"
					)
					# 对数据进行深拷贝，在副本上进行修改
					data_a_copy = copy.deepcopy(all_data[path_a])
					data_b_copy = copy.deepcopy(all_data[path_b])

					# normalize_and_sync_dicts 在副本上操作，并返回是否有更改
					# 它会修改传入的副本
					if normalize_and_sync_dicts(
						data_a_copy,
						data_b_copy,
						lang_a,
						lang_b,
						all_data,  # 传递全局数据用于查找源
						languages,  # 传递全局语言映射用于查找源
						REFERENCE_LANG_CODES,
					):
						# 如果 normalize_and_sync_dicts 报告有更改，检查副本是否确实与内存中的数据不同
						# 如果不同，则更新内存中的数据，并标记 made_changes
						if data_a_copy != all_data[path_a]:
							print(
								f"  * 检测到更改于 {lang_a} ({os.path.basename(path_a)})"
							)
							all_data[path_a] = data_a_copy  # 更新内存中的数据
							made_changes = True
						if data_b_copy != all_data[path_b]:
							print(
								f"  * 检测到更改于 {lang_b} ({os.path.basename(path_b)})"
							)
							all_data[path_b] = data_b_copy  # 更新内存中的数据
							made_changes = True
					# else: print(f"  ( {lang_a} <-> {lang_b} 无实质性更改)") # 太多输出，暂时注释

			if not made_changes:
				print("\n内容同步完成，本轮无更改。")
				break  # 没有更改发生，退出迭代循环
			elif iteration == MAX_SYNC_ITERATIONS:
				print("\n警告：达到最大同步迭代次数，内容同步可能未完全收敛。")
			else:
				print(f"\n第 {iteration} 轮同步检测到更改，继续下一轮...")

	# --- 最终排序 ---
	# 确保参考文件在 all_data 中仍然存在
	if ref_path not in all_data:
		print(
			f"\n错误: 参考文件 '{os.path.basename(ref_path)}' 在同步过程中丢失，无法进行排序。"
		)
		# 尝试使用剩余的第一个文件作为新的参考进行排序
		if all_data:
			new_ref_path = next(iter(all_data.keys()))
			new_ref_lang = languages[new_ref_path]
			print(
				f"尝试使用文件 '{os.path.basename(new_ref_path)}' ({new_ref_lang}) 作为新的排序参考。"
			)
			ref_path = new_ref_path
			ref_lang = new_ref_lang
		else:
			print("没有文件剩余，跳过排序和保存。")
			sys.exit(1)  # 没有文件可保存，退出

	print(
		f"\n开始根据参考文件 '{os.path.basename(ref_path)}' ({ref_lang}) 对所有文件进行排序..."
	)
	final_ordered_data = OrderedDict()
	ref_data_final = all_data[ref_path]  # 使用最新同步后的参考数据作为排序模板

	# 对所有文件进行排序，包括参考文件自身（虽然参考文件通常已经是理想顺序）
	for filepath in all_data.keys():  # 遍历所有已加载且处理过的文件路径
		data = all_data[filepath]
		lang = languages[filepath]
		print(f"  - 排序文件: {os.path.basename(filepath)} ({lang})")
		final_ordered_data[filepath] = reorder_keys_like_reference(
			data,
			ref_data_final,  # 使用参考文件的结构进行排序
		)

	# --- 保存文件 ---
	print("\n保存所有更新和排序后的文件...")
	# 确保保存时按照最初加载的顺序（或者按文件名排序的顺序）
	# sorted(final_ordered_data.keys()) 确保顺序一致
	for filepath in sorted(final_ordered_data.keys()):
		data = final_ordered_data[filepath]
		try:
			with open(filepath, "w", encoding="utf-8", newline="\n") as f:
				# 使用 indent="\t" 进行美化，ensure_ascii=False 保留非ASCII字符
				# default=str 添加一个fallback处理不可序列化的类型，虽然不应出现
				json.dump(data, f, ensure_ascii=False, indent="\t", default=str)
				f.write("\n")  # 确保文件末尾有一个换行符
			print(f"  - 已保存: {os.path.basename(filepath)}")
		except Exception as e:
			print(f"  - 错误: 保存 {os.path.basename(filepath)} 时出错: {e}")

	print("\n脚本执行完毕。")


if __name__ == "__main__":
	main()
