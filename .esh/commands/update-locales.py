import json
import os
import copy
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


def get_lang_from_filename(filename):
    """从文件名提取语言代码"""
    return os.path.splitext(os.path.basename(filename))[0]


def get_value_at_path(data_dict, key_path):
    """根据点分隔的路径从嵌套 OrderedDict 获取值"""
    keys = key_path.split(".")
    current_level = data_dict
    try:
        for key in keys:
            current_level = current_level[key]
        return current_level, True
    except (KeyError, TypeError):
        return None, False


def find_best_translation_source(key_path, all_data, languages_map, reference_codes):
    """根据参考语言优先级查找最佳翻译源。返回 (值, 源语言代码) 或 (None, None)。"""
    # 1. 尝试参考语言
    for ref_lang in reference_codes:
        path = next((p for p, lang in languages_map.items() if lang == ref_lang), None)
        if path and path in all_data:
            value, found = get_value_at_path(all_data[path], key_path)
            if found:
                return value, ref_lang
    # 2. 尝试其他任何语言
    for path, data in all_data.items():
        lang = languages_map.get(path)
        if lang:
            value, found = get_value_at_path(data, key_path)
            if found:
                return value, lang
    # 3. 未找到
    print(f"    - 警告: 无法在任何文件中找到键 '{key_path}' 的源值。")
    return None, None


def translate_text(text, source_lang, target_lang):
    """翻译文本，包含重试逻辑和延时"""
    if not isinstance(text, str) or not text or source_lang == target_lang:
        return text

    print(f"    - 正在翻译: '{text[:30]}...' 从 {source_lang} 到 {target_lang}")
    time.sleep(TRANSLATION_DELAY)

    translator = GoogleTranslator(source=source_lang, target=target_lang)
    try:
        translated = translator.translate(text)
        return translated if translated is not None else ""
    except Exception as e:
        print(
            f"    - 翻译 '{text[:20]}...' ({source_lang} -> {target_lang}) 初始失败: {e}"
        )

        # 准备备选方案
        s_base = source_lang.split("-")[0]
        t_lower = target_lang.lower()
        t_base = target_lang.split("-")[0]
        t_cap = ""
        if "-" in target_lang and len(parts := target_lang.split("-")) == 2:
            t_cap = f"{parts[0].lower()}-{parts[1].upper()}"

        # (source, target) 尝试列表
        attempts = [
            (source_lang, t_lower),  # zh-CN -> zh-cn
            (source_lang, t_cap),  # zh-CN -> zh-CN (修复大小写)
            (source_lang, t_base),  # zh-CN -> zh
            (s_base, target_lang),  # zh -> zh-CN
            (s_base, t_lower),  # zh -> zh-cn
            (s_base, t_cap),  # zh -> zh-CN
            (s_base, t_base),  # zh -> zh
        ]

        # 去重并过滤无效/相同组合
        unique_attempts = []
        seen = set([(source_lang, target_lang)])  # 记录已尝试的组合
        for s, t in attempts:
            if s and t and s != t and (s, t) not in seen:
                unique_attempts.append((s, t))
                seen.add((s, t))

        for s_try, t_try in unique_attempts:
            try:
                print(f"      - 尝试备选: source={s_try}, target={t_try}")
                time.sleep(TRANSLATION_DELAY)
                translator = GoogleTranslator(source=s_try, target=t_try)
                translated = translator.translate(text)
                if translated is not None:
                    print(f"      - 备选方案成功!")
                    return translated
                print(f"      - 备选方案 ({s_try} -> {t_try}) 返回 None")
            except Exception as e2:
                print(f"      - 尝试 {s_try} -> {t_try} 失败: {e2}")

        print(
            f"    - 无法翻译 '{text[:20]}...' ({source_lang} -> {target_lang})，保留原文。"
        )
        return text


def translate_value(value, source_lang, target_lang):
    """递归地翻译值（字符串、列表或 OrderedDict）"""
    if isinstance(value, str):
        return translate_text(value, source_lang, target_lang)
    elif isinstance(value, OrderedDict):
        return OrderedDict(
            (k, translate_value(v, source_lang, target_lang)) for k, v in value.items()
        )
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
    返回一个布尔值，指示是否有更改发生。
    """
    changed = False
    keys_a = set(dict_a.keys())
    keys_b = set(dict_b.keys())
    all_keys = list(keys_a.union(keys_b))  # 固定迭代顺序

    # 先处理共有的键和结构标准化
    for key in list(dict_a.keys()):  # 迭代副本以允许修改
        if key in dict_b:
            current_path = f"{path}.{key}" if path else key
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
            val_a, val_b = dict_a[key], dict_b[key]
            type_a, type_b = type(val_a), type(val_b)

            # --- 递归或类型检查 ---
            if type_a == OrderedDict and type_b == OrderedDict:
                if normalize_and_sync_dicts(
                    val_a,
                    val_b,
                    lang_a,
                    lang_b,
                    all_data_global,
                    languages_global,
                    reference_codes,
                    current_path,
                ):
                    changed = True
            elif type_a != type_b and not standardized:  # 标准化后类型仍不匹配
                print(
                    f"  - 警告: 类型不匹配 @ '{current_path}'. {lang_a}: {type_a.__name__}, {lang_b}: {type_b.__name__}. 跳过递归。"
                )

    # 再处理缺失的键
    for key in all_keys:
        current_path = f"{path}.{key}" if path else key
        in_a = key in dict_a
        in_b = key in dict_b

        # 需要添加的情况 (A缺 或 B缺)
        if not in_a or not in_b:
            target_dict, target_lang, source_lang_approx = (
                (dict_a, lang_a, lang_b) if not in_a else (dict_b, lang_b, lang_a)
            )
            missing_in = lang_a if not in_a else lang_b

            print(f"  - 键缺失: '{current_path}' 在 {missing_in} 中。 查找源...")
            source_value, source_lang = find_best_translation_source(
                current_path, all_data_global, languages_global, reference_codes
            )

            if source_value is not None and source_lang is not None:
                # 尝试基于已知的值类型进行简单的结构匹配（如果源和目标语言不同）
                ref_value = (
                    dict_b.get(key) if not in_a else dict_a.get(key)
                )  # 获取“对方”的值作为参考结构
                if ref_value is not None and type(source_value) != type(ref_value):
                    if (
                        isinstance(ref_value, OrderedDict)
                        and "text" in ref_value
                        and isinstance(source_value, str)
                    ):
                        source_value = OrderedDict([("text", source_value)])
                        print(f"    - 将源值 ({source_lang}) 标准化为 dict 结构")
                    elif (
                        isinstance(ref_value, str)
                        and isinstance(source_value, OrderedDict)
                        and "text" in source_value
                        and len(source_value) == 1
                    ):
                        source_value = source_value["text"]
                        print(f"    - 将源值 ({source_lang}) 标准化为 str 结构")

                print(
                    f"  - 添加缺失键: '{current_path}' 到 {target_lang} (从 {source_lang} 翻译)"
                )
                translated_val = translate_value(
                    copy.deepcopy(source_value), source_lang, target_lang
                )
                target_dict[key] = translated_val  # 添加到目标字典
                changed = True
            else:
                print(
                    f"  - 无法为 '{current_path}' 找到翻译源，跳过添加到 {missing_in}。"
                )

    return changed


def reorder_keys_like_reference(target_dict, reference_dict):
    """递归地按 reference_dict 的键顺序重新排序 target_dict (必须是 OrderedDict)。"""
    if not isinstance(target_dict, OrderedDict) or not isinstance(
        reference_dict, OrderedDict
    ):
        return target_dict  # 类型不符或不是 OrderedDict，无法排序

    ordered_target = OrderedDict()
    ref_keys = set(reference_dict.keys())

    # 1. 按参考顺序添加共有键
    for key, ref_value in reference_dict.items():
        if key in target_dict:
            value = target_dict[key]
            if isinstance(value, OrderedDict) and isinstance(ref_value, OrderedDict):
                ordered_target[key] = reorder_keys_like_reference(
                    value, ref_value
                )  # 递归排序
            else:
                ordered_target[key] = value

    # 2. 添加目标中有但参考中没有的键 (保持相对顺序)
    extra_keys = [key for key in target_dict if key not in ref_keys]
    if extra_keys:
        # print(f"  - 警告: 目标字典存在参考中没有的键: {extra_keys}。将附加在末尾。")
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
                all_data[filepath] = json.load(f, object_pairs_hook=OrderedDict)
                languages[filepath] = lang
                lang_to_path[lang] = filepath
                print(f"  - 已加载: {filename} ({lang})")
        except (json.JSONDecodeError, Exception) as e:
            print(f"  - 错误: 加载或解析 {filename} 时出错: {e}. 跳过。")

    if len(all_data) < 2:
        print("需要至少两个有效的本地化文件才能进行同步。")
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
        ref_path = next(iter(all_data.keys()))  # 使用第一个加载的文件作为后备
        ref_lang = languages[ref_path]
        print(
            f"\n警告: 未找到配置的参考语言。使用第一个文件 '{os.path.basename(ref_path)}' ({ref_lang}) 作为参考。"
        )

    # --- 同步迭代 ---
    print("\n开始同步内容和结构...")
    for iteration in range(1, MAX_SYNC_ITERATIONS + 1):
        print(f"\n--- 同步迭代轮次 {iteration}/{MAX_SYNC_ITERATIONS} ---")
        made_changes = False
        file_paths = list(all_data.keys())  # 当前有效文件列表

        for i in range(len(file_paths)):
            for j in range(i + 1, len(file_paths)):
                path_a, path_b = file_paths[i], file_paths[j]
                lang_a, lang_b = languages[path_a], languages[path_b]

                print(f"\n比较: {lang_a} <-> {lang_b}")
                data_a_copy = copy.deepcopy(all_data[path_a])
                data_b_copy = copy.deepcopy(all_data[path_b])

                # normalize_and_sync operates on copies and returns if changes happened
                if normalize_and_sync_dicts(
                    data_a_copy,
                    data_b_copy,
                    lang_a,
                    lang_b,
                    all_data,
                    languages,
                    REFERENCE_LANG_CODES,
                ):
                    # If sync reported changes, check if they differ from original memory state
                    if data_a_copy != all_data[path_a]:
                        print(f"  * 检测到更改于 {lang_a}")
                        all_data[path_a] = data_a_copy  # Update in-memory data
                        made_changes = True
                    if data_b_copy != all_data[path_b]:
                        print(f"  * 检测到更改于 {lang_b}")
                        all_data[path_b] = data_b_copy  # Update in-memory data
                        made_changes = True
                # else: print("  (无更改)")

        if not made_changes:
            print("\n内容同步完成，本轮无更改。")
            break
        elif iteration == MAX_SYNC_ITERATIONS:
            print("\n警告：达到最大同步迭代次数，内容同步可能未完全收敛。")
        else:
            print(f"\n第 {iteration} 轮同步检测到更改，继续...")

    # --- 最终排序 ---
    print(
        f"\n开始根据参考文件 '{os.path.basename(ref_path)}' ({ref_lang}) 对所有文件进行排序..."
    )
    final_ordered_data = OrderedDict()
    ref_data_final = all_data[ref_path]  # 使用最新同步后的参考数据

    for filepath, data in all_data.items():
        lang = languages[filepath]
        print(f"  - 排序文件: {os.path.basename(filepath)} ({lang})")
        # 自身也需要通过函数处理，以防参考文件内部顺序在加载时就不是最优的（虽然不太可能）
        # 或者简单地假设参考文件加载后的顺序就是黄金标准
        # final_ordered_data[filepath] = reorder_keys_like_reference(data, ref_data_final)
        if filepath == ref_path:
            final_ordered_data[filepath] = data  # 直接使用参考文件当前状态
        else:
            final_ordered_data[filepath] = reorder_keys_like_reference(
                data, ref_data_final
            )

    # --- 保存文件 ---
    print("\n保存所有更新和排序后的文件...")
    for filepath, data in final_ordered_data.items():
        try:
            with open(filepath, "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, indent="\t")
                f.write("\n")  # 确保末尾有换行符
            print(f"  - 已保存: {os.path.basename(filepath)}")
        except Exception as e:
            print(f"  - 错误: 保存 {os.path.basename(filepath)} 时出错: {e}")

    print("\n脚本执行完毕。")


if __name__ == "__main__":
    main()
