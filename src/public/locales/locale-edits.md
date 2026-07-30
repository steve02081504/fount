# Locale bulk edits

Day-to-day i18n rules: [root AGENTS.md](../../../AGENTS.md).

## Moving keys

Use `.esh/commands/update_locale_data.py` — **move with `get(old)` → `set(new, value)` → `set(old, None)`** so each locale keeps its existing copy.

Never delete then refill from zh-CN: `fake` / `emoji` and other non-Google targets collapse to Chinese.

When updating call sites, rewrite only quoted i18n key strings — do not blind-replace `profile.xxx` object fields or module paths.

**写回 locale JSON 只用 Python**（`update_locale_data.py` / `update-locales.py` / `reshape_i18n_keys.py`）。JS `JSON.stringify` 会把纯数字键（如 `"404"`）排到对象最前，打乱键序。

## Prefix nest reshape

同级 ≥4 个驼峰共享前缀时，用：

```text
python .esh/commands/reshape_i18n_keys.py
python .esh/commands/reshape_i18n_keys.py path/to/extra_renames.json
```

会嵌套全部 locale、写出 `data/test/i18n_key_rename_map.json`，并改写仓库内引号中的旧键。第二遍 exact 补洞仍可用 `src/scripts/checks/tools/rewrite_i18n_exact_pass.mjs`（只改源码，不写 locale）。

## Reshape string → `{ title, aria-label }`

Icon / tooltip-only controls: keep each locale's existing string, wrap in place — do **not** retranslate via `update-locales.py`.

```text
update_locale_data "for key in ('chat.emoji.jumpToStart', 'chat.emoji.jumpToUnicode', 'chat.emoji.recent'):
  value = get(key)
  if isinstance(value, str) and value:
    set(key, {'title': value, 'aria-label': value})
  elif isinstance(value, dict):
    label = value.get('title') or value.get('aria-label') or value.get('textContent')
    if label:
      set(key, {'title': label, 'aria-label': label})
"
```

Same pattern for unicode group labels (`chat.unicodeEmojiGroups.*`). Rail uses the object key (`title` / `aria-label`); section header uses `` `${key}.title` `` as a string leaf so visible text fills without wiping rail glyphs.

Frontend: `data-i18n` on the key; put the icon in `innerHTML` / children — object locales only set `title` / `aria-label`, they do not wipe markup. Do **not** add `textContent`/`innerHTML` to icon-button locales.
