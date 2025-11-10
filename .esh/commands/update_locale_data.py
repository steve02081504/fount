import os
import json
import sys

locales_dir = os.path.abspath(os.path.join(os.getcwd(), "src", "locales"))
script_to_run = sys.argv[1] if len(sys.argv) > 1 else None

if not script_to_run:
    print("Error: Please provide a script string to evaluate.")
    print("Usage: update_locale_data \"set('some.key', 'some.value')\"")
    print("Example: update_locale_data \"value = get('a.b.c'); if value is not None: set('d.f.g', value); set('a.b.c', None) # set(key, None) deletes the key\"")
    sys.exit(1)


def get_nested_value(obj, key):
    """
    从对象中获取嵌套值，使用点分隔的键。
    @param obj - 要从中检索值的对象。
    @param key - 要检索的点分隔键。
    @returns 指定键处的值，如果未找到则为 None。
    """
    keys = key.split(".")
    value = obj
    for k in keys:
        if isinstance(value, dict) and k in value:
            value = value[k]
        else:
            return None
    return value


def set_nested_value(obj, key, value):
    """
    使用点分隔的键在对象中设置嵌套值。
    @param obj - 要设置值的对象。
    @param key - 要设置的点分隔键。
    @param value - 要设置的值。如果为 None，则删除该键。
    """
    keys = key.split(".")
    current = obj
    for i in range(len(keys) - 1):
        k = keys[i]
        if not isinstance(current, dict) or k not in current or not isinstance(current[k], dict):
            current[k] = {}
        current = current[k]

    final_key = keys[-1]
    if value is None:
        if final_key in current:
            del current[final_key]
    else:
        current[final_key] = value


def process_locale_files():
    """
    处理 `src/locales` 目录中的所有语言环境 JSON 文件。
    对于每个文件，它读取内容，通过 `exec` 应用用户定义的脚本，
    然后将修改后的内容以制表符缩进写回文件。
    """
    try:
        files = os.listdir(locales_dir)
        json_files = [f for f in files if f.endswith(".json")]

        for file_name in json_files:
            file_path = os.path.join(locales_dir, file_name)
            print(f"Processing {file_name}...")

            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    file_content = f.read()
                data = json.loads(file_content)

                # Define get and set functions for the script to use
                def get(key):
                    return get_nested_value(data, key)

                def set(key, value):
                    set_nested_value(data, key, value)

                # Create a dictionary for the script's global scope
                script_globals = {"get": get, "set": set}
                exec(script_to_run, script_globals)

                updated_content = json.dumps(data, indent="\t", ensure_ascii=False)  # Use indent=4 for tabs, ensure_ascii=False for non-ASCII chars
                with open(file_path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(updated_content + "\n")
                print(f"Successfully updated {file_name}.")

            except Exception as err:
                print(f"Error processing file {file_name}: {err}", file=sys.stderr)

    except Exception as err:
        print(f"Error reading locales directory: {err}", file=sys.stderr)


if __name__ == "__main__":
    process_locale_files()
