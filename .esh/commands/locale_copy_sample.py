"""Sample locale copy for a native-quality review round, and apply the verdicts.

The machine-checkable defects live in `fount test checks:i18n_copy`; what a check
cannot see is copy that is grammatical but still smells machine-translated. This
tool drives that part of the loop:

    python .esh/commands/locale_copy_sample.py sample de-DE --seed round-1
    #   -> data/locale_copy_review/de-DE/round-1.tsv  (key / value / zh-CN / en-UK)
    #   hand the TSV to a native reviewer; it answers with a JSONL patch
    python .esh/commands/locale_copy_sample.py apply de-DE patch.jsonl

`sample` never touches a locale file. `apply` refuses a record whose key is
missing or whose `${placeholder}` set differs from the
zh-CN source of truth; unchanged values are skipped, and accepted values are written back with the file's own key
order preserved (a plain JSON round-trip is byte-identical for these files).
"""
import argparse
import json
import os
import random
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOCALES_DIR = os.path.join(ROOT, "src", "public", "locales")
REVIEW_DIR = os.path.join(ROOT, "data", "locale_copy_review")
PLACEHOLDER = re.compile(r"(?<!\\)\$\{[^}]*\}")
# values that carry no prose to review
TOKEN_ONLY = re.compile(r"^[\s\w./:@${}<>|*+~^=,\-\[\]()'\"]*$", re.UNICODE)
SKIP_KEYS = {"lang", "name"}


def leaf_items(node, prefix="", out=None):
	"""Flatten a locale tree to (dotted key, string leaf) pairs in file order."""
	if out is None:
		out = []
	if isinstance(node, str):
		out.append((prefix, node))
	elif isinstance(node, list):
		for index, item in enumerate(node):
			leaf_items(item, f"{prefix}[{index}]", out)
	elif isinstance(node, dict):
		for key, value in node.items():
			if key == "switch":
				continue
			leaf_items(value, f"{prefix}.{key}" if prefix else key, out)
	return out


def load_locale(name, directory=None):
	with open(os.path.join(directory or LOCALES_DIR, f"{name}.json"), encoding="utf-8") as handle:
		return json.load(handle)


def dump_locale(tree):
	return json.dumps(tree, ensure_ascii=False, indent="\t") + "\n"


PROMPT_TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "public", "locales", "docs", "locale_copy_review_prompt.md")
LANGUAGE_NAMES = {
	"ar-SA": "Arabic", "de-DE": "German", "en-UK": "British English", "es-ES": "Spanish (Spain)",
	"fr-FR": "French", "hi-IN": "Hindi", "is-IS": "Icelandic", "it-IT": "Italian", "ja-JP": "Japanese",
	"ko-KR": "Korean", "lzh": "Literary Chinese", "nl-NL": "Dutch", "pt-PT": "Portuguese (Portugal)",
	"ru-RU": "Russian", "uk-UA": "Ukrainian", "vi-VN": "Vietnamese", "zh-TW": "Traditional Chinese (Taiwan)",
}


def locale_rules(locale):
	"""The locale's own paragraph from the prompt template's rules section."""
	with open(PROMPT_TEMPLATE, encoding="utf-8") as handle:
		text = handle.read()
	match = re.search(rf"^\*\*{re.escape(locale)}\*\* — (.*?)(?=\n\n\*\*|\Z)", text, re.DOTALL | re.MULTILINE)
	return f"LOCALE-SPECIFIC RULES for {LANGUAGE_NAMES.get(locale, locale)}:\n{match.group(1).strip()}" if match else ""


def round_history(locale, review_dir=None):
	"""What earlier rounds settled for this language."""
	directory = os.path.join(review_dir or REVIEW_DIR, locale)
	patches = [name for name in os.listdir(directory) if name.endswith('.patch.jsonl')] if os.path.isdir(directory) else []
	if not patches:
		return "This is the first review of this file."
	return (f"This file has already been reviewed in {len(patches)} round(s): earlier rounds settled the machine residue "
	        f"(compound spacing, zero-width characters, literal CLI/path/identifier tokens, markup, punctuation) and the "
	        f"terminology decisions recorded in the review directory. Do not re-open those; this round is a fresh-eyes read "
	        f"of copy that is grammatical but does not sound like a native product team wrote it.")


def worklist_block(locale, review_dir=None):
	"""Point the reviewer at the worklists that still have rows."""
	directory = os.path.join(review_dir or REVIEW_DIR, locale)
	lines = []
	for name, what in (('markup.md', 'markup the source carries and this locale dropped'),
	                   ('brand.md', 'rows where the zh-CN source names the product `fount` but this locale never writes it — judge each one and put the name back where it belongs'),
	                   ('drift.md', 'keys whose zh-CN source sentence is identical but whose wording diverges inside this locale — unify the siblings, or say why the difference is deliberate')):
		path = os.path.join(directory, name)
		if not os.path.isfile(path):
			continue
		with open(path, encoding='utf-8') as handle:
			if sum(1 for line in handle if line.startswith('## ')) == 0:
				continue
		lines.append(f"- {path} — {what}. Fix those rows in this round as well, keeping the prose otherwise intact.")
	return ("## Worklists (required)\n" + "\n".join(lines)) if lines else "## Worklists\nNo markup or identifier worklist is outstanding for this language."


def build_prompt(locale, seed, review_dir=None):
	"""Fill the reviewer prompt for one round; returns (path, text)."""
	review_dir = review_dir or REVIEW_DIR
	directory = os.path.join(review_dir, locale)
	sample = os.path.join(directory, f"{seed}.tsv")
	patch = os.path.join(directory, f"{seed}.patch.jsonl")
	with open(PROMPT_TEMPLATE, encoding="utf-8") as handle:
		template = handle.read()
	sections = template.split("\n---\n")
	body = sections[1] if len(sections) > 1 else template
	filled = (body
		.replace("@@LANGUAGE@@", LANGUAGE_NAMES.get(locale, locale))
		.replace("@@LOCALE@@", locale)
		.replace("@@SAMPLE@@", sample)
		.replace("@@PATCH@@", patch)
		.replace("@@HISTORY@@", round_history(locale, review_dir))
		.replace("@@WORKLISTS@@", worklist_block(locale, review_dir))
		.replace("@@RULES@@", locale_rules(locale)))
	path = os.path.join(directory, f"{seed}.prompt.md")
	os.makedirs(directory, exist_ok=True)
	with open(path, "w", encoding="utf-8", newline="\n") as handle:
		handle.write(filled.rstrip() + "\n")
	return path, filled


def resolve(tree, key):
	"""Return (container, leaf) for a dotted key with optional [index] parts."""
	parts = []
	for name, index in re.findall(r"([^.\[\]]+)|\[(\d+)\]", key):
		parts.append(name if name else int(index))
	node = tree
	for part in parts[:-1]:
		try:
			node = node[part]
		except (KeyError, IndexError, TypeError):
			return None
	leaf = parts[-1]
	if isinstance(node, dict) and leaf in node:
		return node, leaf
	if isinstance(node, list) and isinstance(leaf, int) and -len(node) <= leaf < len(node):
		return node, leaf
	return None


def is_reviewable(key, value):
	"""Prose worth a native read: has whitespace and letters, is not a pure token."""
	if not value or key in SKIP_KEYS or key.endswith(".switch"):
		return False
	if key.endswith((".aria-label", ".title")) and len(value) < 4:
		return False
	if len(value) < 8 or not re.search(r"\w\s+\w", value):
		return False
	return not TOKEN_ONLY.match(value)


def load_ledger(locale, review_dir=None):
	"""Keys already sampled for this locale, so later rounds cover fresh copy."""
	path = os.path.join(review_dir or REVIEW_DIR, locale, "sampled.json")
	if not os.path.isfile(path):
		return []
	with open(path, encoding="utf-8") as handle:
		return json.load(handle)


def save_ledger(locale, keys, review_dir=None):
	path = os.path.join(review_dir or REVIEW_DIR, locale, "sampled.json")
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, "w", encoding="utf-8", newline="\n") as handle:
		handle.write(json.dumps(sorted(set(keys)), ensure_ascii=False, indent=1) + "\n")


def build_sample(locale, count, seed, review_dir=None, locales_dir=None, ledger=None, fresh=True):
	"""Pick `count` prose leaves deterministically; return (rows, path).

	`ledger` holds keys earlier rounds already reviewed; with `fresh` they are
	skipped so every round sees new copy (and a short result means the file has
	been sampled through).
	"""
	review_dir = review_dir or REVIEW_DIR
	locales_dir = locales_dir or LOCALES_DIR
	trees = {name: load_locale(name, locales_dir) for name in ("zh-CN", "en-UK", locale)}
	source, reference = dict(leaf_items(trees["zh-CN"])), dict(leaf_items(trees["en-UK"]))
	candidates = [(key, value) for key, value in leaf_items(trees[locale]) if is_reviewable(key, value)]
	if fresh and ledger:
		seen = set(ledger)
		candidates = [(key, value) for key, value in candidates if key not in seen]
	random.Random(seed).shuffle(candidates)
	rows = sorted(candidates[:count])
	out_dir = os.path.join(review_dir, locale)
	os.makedirs(out_dir, exist_ok=True)
	path = os.path.join(out_dir, f"{seed}.tsv")
	with open(path, "w", encoding="utf-8", newline="\n") as handle:
		handle.write("key\tvalue\tzh-CN\ten-UK\n")
		for key, value in rows:
			handle.write("\t".join(json.dumps(cell, ensure_ascii=False)
				for cell in (key, value, source.get(key, ""), reference.get(key, ""))) + "\n")
	return rows, path


def coverage(locale, review_dir=None, locales_dir=None):
	"""(sampled, reviewable) key counts for one locale."""
	locales_dir = locales_dir or LOCALES_DIR
	reviewed = set(load_ledger(locale, review_dir))
	reviewable = [key for key, value in leaf_items(load_locale(locale, locales_dir)) if is_reviewable(key, value)]
	return len(reviewed & set(reviewable)), len(reviewable)


def apply_patch(locale, records, directory=None, write=True):
	"""Validate records against the locale + zh-CN and write the accepted ones."""
	directory = directory or LOCALES_DIR
	target = os.path.join(directory, f"{locale}.json")
	with open(target, encoding="utf-8") as handle:
		tree = json.load(handle)
	with open(os.path.join(directory, "zh-CN.json"), encoding="utf-8") as handle:
		source_tree = json.load(handle)
	accepted, rejected = [], []
	for record in records:
		key, new = record.get("key"), record.get("new")
		found = resolve(tree, key) if isinstance(key, str) else None
		if not isinstance(new, str) or not found:
			rejected.append((key, "unknown key or non-string value"))
			continue
		container, leaf = found
		if container[leaf] == new:
			continue
		anchor = resolve(source_tree, key)
		anchor = anchor[0][anchor[1]] if anchor else container[leaf]
		if isinstance(anchor, str) and sorted(PLACEHOLDER.findall(new)) != sorted(PLACEHOLDER.findall(anchor)):
			rejected.append((key, "placeholder set differs from zh-CN"))
			continue
		accepted.append((key, new))
	for key, new in accepted:
		container, leaf = resolve(tree, key)
		container[leaf] = new
	if write and accepted:
		with open(target, "w", encoding="utf-8", newline="") as handle:
			handle.write(dump_locale(tree))
	return accepted, rejected


def read_patch(path):
	records = []
	with open(path, encoding="utf-8") as handle:
		for number, line in enumerate(handle, 1):
			line = line.strip()
			if not line or line.startswith("#"):
				continue
			records.append(json.loads(line))
	return records


def self_test():
	"""Sampling determinism + patch application, on a synthetic locale tree."""
	with tempfile.TemporaryDirectory() as directory:
		trees = {
			"zh-CN": {"a": {"prose": "这是一段有内容的文案。", "frame": "\n行", "num": "数字：${n}"}},
			"en-UK": {"a": {"prose": "This is a real sentence.", "frame": "\nline", "num": "Number: ${n}"}},
			"xx-XX": {"a": {"prose": "Dies ist ein echter Satz.", "frame": "line", "num": "Zahl: ${n}", "short": "ok"}},
		}
		for name, tree in trees.items():
			with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8", newline="") as handle:
				handle.write(dump_locale(tree))
		first, path = build_sample("xx-XX", 2, "self", directory, directory)
		second, _ = build_sample("xx-XX", 2, "self", directory, directory)
		assert first == second, "sampling must be deterministic for one seed"
		assert all(key != "a.short" for key, _ in first), "short token values stay out of the sample"
		assert os.path.isfile(path)
		fresh, _ = build_sample("xx-XX", 2, "self", directory, directory, ledger=[key for key, _ in first])
		assert not {key for key, _ in fresh} & {key for key, _ in first}, "ledger keys are not sampled twice"
		reviewable = [key for key, value in leaf_items(trees["xx-XX"]) if is_reviewable(key, value)]
		assert coverage("xx-XX", directory, directory)[1] == len(reviewable), "coverage counts the reviewable leaves"

		accepted, rejected = apply_patch("xx-XX", [
			{"key": "a.prose", "new": "Ein besserer Satz."},
			{"key": "a.num", "new": "Zahl ${weg}"},
			{"key": "a.missing", "new": "x"},
			{"key": "a.frame", "new": "\nline"},
		], directory)
		assert [key for key, _ in accepted] == ["a.prose", "a.frame"], accepted
		assert [why for _, why in rejected] == ["placeholder set differs from zh-CN", "unknown key or non-string value"], rejected
		with open(os.path.join(directory, "xx-XX.json"), encoding="utf-8") as handle:
			written = json.load(handle)
		assert written["a"]["prose"] == "Ein besserer Satz." and written["a"]["frame"] == "\nline"
		assert list(written) == ["a"] and list(written["a"]) == ["prose", "frame", "num", "short"], "key order must survive"

		prompt_path, prompt = build_prompt("de-DE", "self", directory)
		assert os.path.isfile(prompt_path), "the reviewer brief is written next to the sample"
		assert "You are a native German software localization editor" in prompt, prompt[:200]
		assert os.path.join(directory, "de-DE", "self.tsv") in prompt, prompt[:400]
		assert os.path.join(directory, "de-DE", "self.patch.jsonl") in prompt
		assert "LOCALE-SPECIFIC RULES for German:" in prompt, "the locale's own rules block is filled in"
		assert "## Worklists" in prompt and "## Second look" in prompt
		assert "@@" not in prompt, "no placeholder is left unfilled"
	print("locale_copy_sample self-test ok")


def main():
	parser = argparse.ArgumentParser(prog="locale_copy_sample", description=__doc__.splitlines()[0])
	parser.add_argument("--self-test", action="store_true")
	sub = parser.add_subparsers(dest="command")
	sample = sub.add_parser("sample", help="write a review sample for one locale")
	sample.add_argument("locale")
	sample.add_argument("--count", type=int, default=120)
	sample.add_argument("--seed", default="round-1")
	sample.add_argument("--resample", action="store_true", help="ignore the ledger and sample the whole file again")
	status = sub.add_parser("status", help="how much of a locale has been sampled")
	status.add_argument("locale", nargs="?")
	prompt = sub.add_parser("prompt", help="fill the reviewer prompt for one round")
	prompt.add_argument("locale")
	prompt.add_argument("seed", nargs="?", default="round-1")
	apply_ = sub.add_parser("apply", help="apply a reviewer patch to one locale")
	apply_.add_argument("locale")
	apply_.add_argument("patch")
	args = parser.parse_args()

	if args.self_test:
		self_test()
		return
	if args.command == "sample":
		ledger = load_ledger(args.locale)
		rows, path = build_sample(args.locale, args.count, args.seed, ledger=ledger, fresh=not args.resample)
		save_ledger(args.locale, ledger + [key for key, _ in rows])
		sampled, total = coverage(args.locale)
		print(f"{len(rows)} rows -> {path}  (sampled {sampled}/{total} reviewable leaves)")
	elif args.command == "status":
		locales = [args.locale] if args.locale else sorted(
			name[:-5] for name in os.listdir(LOCALES_DIR) if name.endswith(".json") and name != "zh-CN.json")
		for locale in locales:
			sampled, total = coverage(locale)
			print(f"{locale.ljust(7)} sampled {sampled}/{total}")
	elif args.command == "prompt":
		path, _ = build_prompt(args.locale, args.seed)
		print(f"prompt -> {path}")
	elif args.command == "apply":
		if not os.path.isfile(args.patch):
			sys.exit(f"patch not found: {args.patch}")
		accepted, rejected = apply_patch(args.locale, read_patch(args.patch))
		print(f"{args.locale}: {len(accepted)} applied, {len(rejected)} rejected")
		for key, why in rejected:
			print(f"   REJECT {key}: {why}")
	else:
		parser.print_help()


if __name__ == "__main__":
	main()
