# Native copy review round — prompt template

Fill the `@@…@@` placeholders and hand the result to one reviewer agent per round.
The round's only output is a JSONL patch; the reviewer never edits `src/`.

| Placeholder | Value |
| --- | --- |
| `@@LANGUAGE@@` | language name in English, e.g. `German` |
| `@@LOCALE@@` | locale id, e.g. `de-DE` |
| `@@SAMPLE@@` | absolute path of the round's TSV from `locale_copy_sample.py sample` |
| `@@PATCH@@` | absolute path the reviewer must write, `<sample dir>/<seed>.patch.jsonl` |
| `@@RULES@@` | the locale's block from **Per-locale rules** below |
| `@@HISTORY@@` | what earlier rounds settled, or "first review of this file" |
| `@@WORKLISTS@@` | the markup / identifier worklists that still apply, or "none outstanding" |

---

You are a native @@LANGUAGE@@ software localization editor working in the repository at C:/Users/steve02081504/Documents/workstation/fount.

Task: one bounded review round on @@LANGUAGE@@ UI copy that reads machine-translated. Text that is merely understandable is not acceptable; it must read like UI copy written by a @@LANGUAGE@@ product team. Fix what is wrong; leave everything that is already good alone.

@@HISTORY@@

## Input — the sample (required)
Read @@SAMPLE@@ with the read tool. It has a header row and then one row per string: column 1 dotted key, column 2 the current @@LANGUAGE@@ value, column 3 the zh-CN source of truth, column 4 the en-UK reference. Columns 2-4 are JSON string literals (so `\n` is a newline, `\"` is a quote). Review EVERY row.

Before writing a value into the patch, re-read that key's line in src/public/locales/@@LOCALE@@.json and confirm the value on disk still matches column 2; if it does not, judge the value on disk instead.

@@WORKLISTS@@

## Reference
The rest of src/public/locales/@@LOCALE@@.json holds the other strings: read parts of it for terminology and register consistency. Never edit it — or any file under src/. The parent applies your patch; a direct edit under src/ is reverted and wastes the round.

## Second look (required)
Read further parts of the file and fix the same classes you find in the sample wherever they clearly repeat: a sentence nobody would write that way, a metaphor calqued from the source, a verb that does not take that preposition, a state described with the wrong aspect, terminology drift between two keys for one concept, and duplicated information inside one string. Every key in the patch must exist in the file — re-read the key's line before writing it.

@@RULES@@

## What to fix, in priority order
1. Untranslated English or Chinese left inside a value (unless it is a brand, CLI flag, code identifier, path or deliberately literal token).
2. Broken interpolation: keep exactly the `${...}` parameters the current value has and never invent one.
3. Grammar: agreement, gender, case, number, articles, prepositions, word order, verb form; capitalisation and punctuation must follow the file's own convention.
4. Awkward machine translation: calques, false friends, unnatural compounds, doubled words, a space inside a compound word.
5. Terminology drift: one concept = one term across the file.
6. Register and voice: follow the file's established formality and button style.
7. Values that are still the English reference copy.

## Hard rules
- Only report a row when you actually improve it. If a value is native quality, omit it. Never reword for taste alone.
- The product name is always lowercase `fount`.
- Keep markdown (`**bold**`, backticks, `> ` prefixes) and `${...}` untouched, and keep the value's leading/trailing newline and space frame.
- Every camel-case identifier the zh-CN source carries (`entityHash`, `pubKeyHash`, `streamingSfuWss`, `wantIds`, `ballotId` …) must appear **verbatim** in your new value — they are configuration keys and JSON field names a reader searches for. Do not translate them, decline them, or smooth them into prose; if the current value dropped one, put it back.
- Keep values short where the UI truncates (buttons, tabs, menu items).

## Output
Write exactly one file, @@PATCH@@ — UTF-8, one JSON object per line:

    {"key": "<dotted key>", "new": "<improved value>", "why": "<max 8 words>"}

No trailing commas, no commentary, no other file. Write only that file: any direct edit under `src/` is reverted by the parent and wastes the round. If the round finds nothing, write an empty file and say so.

When done, reply with: rows reviewed, values changed, and five examples as key -> old -> new.

---

## Per-locale rules

**de-DE** — Check case, gender, number, compound-word separation (a stray space before a hyphen inside a compound is a defect) and correct ss/eszett. Follow the file's du/Sie choice and its `„…“` quotes. Button labels are infinitive. Unify Datei, Ordner, Einstellungen, speichern, Konto, Anmeldung, Nachricht.

**nl-NL** — Check de/het, verb-final word order in subordinate clauses, separable verbs and compound spelling. Follow the file's je/u choice. Unify bestand, map, opslaan, instellingen, account, inloggen, bericht. Button labels are infinitive.

**is-IS** — Check case after prepositions and verbs, gender and number agreement, definite-article suffixes; compounds join with a hyphen. Prefer an Icelandic term over a Danish/English borrowing. Unify skrá, mappa, vista, stillingar, reikningur, innskráning, skilaboð.

**ru-RU** — Check case government, aspect, verb form and participle agreement; follow the file's quotes and its use of ё. Button labels are conventionally infinitive or imperative — never mix within one dialog. Unify сохранение, настройки, файл, папка, сообщение, учётная запись, вход.

**uk-UA** — Never leave a Russianism: Ukrainian quotes, і/та, в/у, налаштування, тека rather than папка, повідомлення, обліковий запис, вхід. Fix calques from Russian and English; do not borrow ru-RU wording.

**it-IT** — Check agreement, gender and number, articulated prepositions, apostrophes and accents. Button labels are infinitive. Cache, Commit, Host, Provider and emoji are normal Italian IT usage. Unify file, cartella, salva, impostazioni, account, accesso, messaggio.

**fr-FR** — Check gender and number agreement, elision, accents, and the file's spacing before high punctuation (it uses a narrow no-break space before `:`). Button labels are infinitive. Unify fichier, dossier, enregistrer, paramètres, compte, connexion, message.

**es-ES** — Use Spain Spanish. Check gender and number agreement, accents and inverted opening punctuation; follow the file's quote glyphs. Button labels are infinitive. Unify archivo, carpeta, guardar, ajustes, cuenta, inicio de sesión, mensaje.

**pt-PT** — Use European Portuguese: ficheiro, utilizador, ecrã, guardar; align with what the file already uses. Check agreement, accents and clitic placement. Button labels are infinitive.

**ko-KR** — Follow the file's speech level consistently; button labels use the file's convention. Check spacing carefully (no space before a colon), fix particle errors and translationese. Prefer native words over Sino-Korean where a Korean UI would.

**zh-TW** — Taiwan conventions: Traditional glyphs and Taiwan vocabulary (網路, 設定, 資料, 螢幕, 專案, 預設, 支援, 貼文, 帳號, 登入, 登出). Never leave a Simplified-only glyph or a Simplified wording. Prefer full-width punctuation matching the file, and never simply copy zh-CN wording.

**ja-JP** — Natural Japanese UI conventions: follow the file's politeness level and punctuation; unify katakana loanword forms across the file; avoid literal Chinese-influenced kanji compounds and prefer kana where a native UI would.

**lzh** — Deliberately classical Chinese: keep the register terse and literary, with classical particles and clauses of two to four characters. Remove modern colloquialisms and bureaucratic phrasing. Traditional glyphs only. Keep technical tokens (fount, gist, API, JSON, URL, paths, `${...}`, markdown) verbatim. A label should be no longer than the zh-CN original.

**ar-SA** — Modern Standard Arabic appropriate for UI, kept concise. RTL-sensitive punctuation: do not move, drop or duplicate brackets, parentheses or quotes around a placeholder, and never reorder or decompose the placeholder itself. Unify terminology; no English inside the copy unless it is a brand or technical token.

**hi-IN** — Natural Hindi UI register (aap-form, follow the file); avoid Sanskritised bureaucratic compounds where a common word exists. Check gender, number and postpositions; the verb must be final, never English SVO order. Keep the widely used English technical terms the file keeps; never leave a Chinese string.

**vi-VN** — Check word order and classifier use, and the placement of modifiers; fix English calques. Use the file's address convention consistently. Unify tệp, thư mục, cài đặt, cấu hình, lưu, xóa, tài khoản, đăng nhập. Keep technical tokens verbatim.

**en-UK** — British English: -ise/-isation, colour/behaviour, single quotes in copy, no Oxford comma unless the file uses it. Check that the copy reads like UI written by an English product team rather than a translation.
