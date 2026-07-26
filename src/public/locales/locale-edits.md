# Locale bulk edits

Day-to-day i18n rules: [root AGENTS.md](../../../AGENTS.md).

## Moving keys

Use `.esh/commands/update_locale_data.py` — **move with `get(old)` → `set(new, value)` → `set(old, None)`** so each locale keeps its existing copy.

Never delete then refill from zh-CN: `fake` / `emoji` and other non-Google targets collapse to Chinese.

When updating call sites, rewrite only quoted i18n key strings — do not blind-replace `profile.xxx` object fields or module paths.
