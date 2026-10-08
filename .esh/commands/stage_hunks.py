"""Stage part of a dirty file into the git index without touching the worktree.

`git add -p` is interactive, so an agent cannot use it to split an already-dirty worktree into
several commits. This helper rewrites only the index entry and leaves the worktree byte-identical,
which is what the lossless-split proof in the root `AGENTS.md` ("Commit hygiene") expects.

Usage:
	python .esh/commands/stage_hunks.py <path> --list
	python .esh/commands/stage_hunks.py <path> <hunk> [<hunk> ...]
	python .esh/commands/stage_hunks.py <path> --drop-line <prefix> [<prefix> ...]

Hunk numbers are 1-based in the order `git diff HEAD -- <path>` prints them, so list them again
after every commit: hunks already in HEAD disappear from the diff and the remaining numbers shift.
When one hunk mixes two commits, stage it whole in the earlier commit and use `--drop-line` for the
lines that belong to a later one.
"""
import subprocess
import sys


def hunks_of(path: str):
	"""Return the diff header and the hunk chunks of `git diff HEAD -- <path>`."""
	diff = subprocess.run(['git', 'diff', 'HEAD', '--', path], capture_output=True, check=True).stdout
	header, hunks, current = [], [], None
	for line in diff.splitlines(keepends=True):
		if line.startswith(b'@@'):
			current = [line]
			hunks.append(current)
		elif current is None:
			header.append(line)
		else:
			current.append(line)
	return header, hunks


def index_mode(path: str) -> str:
	"""Return the file mode the index currently records for <path>."""
	listed = subprocess.run(['git', 'ls-files', '-s', '--', path], capture_output=True, check=True, text=True).stdout.split()
	if not listed:
		raise SystemExit(f'{path} is not tracked yet; add it once before staging part of it')
	return listed[0]


def main() -> int:
	path = sys.argv[1]
	args = sys.argv[2:]
	header, hunks = hunks_of(path)
	if not hunks:
		raise SystemExit(f'no diff against HEAD for {path}')
	if args == ['--list']:
		print(f'{path}: {len(hunks)} hunk(s)')
		for number, hunk in enumerate(hunks, 1):
			print(f'  {number}: {hunk[0].decode().strip()}')
		return 0
	if args and args[0] == '--drop-line':
		prefixes = [prefix.encode() for prefix in args[1:]]
		if not prefixes:
			raise SystemExit('--drop-line needs at least one line prefix')
		content = open(path, 'rb').read()
		kept = [line for line in content.splitlines(keepends=True) if not line.startswith(tuple(prefixes))]
		if len(kept) == len(content.splitlines(keepends=True)):
			raise SystemExit('no line matched the given prefixes')
		blob = subprocess.run(['git', 'hash-object', '-w', '--stdin'], input=b''.join(kept), capture_output=True, check=True).stdout.decode().strip()
		subprocess.run(['git', 'update-index', '--cacheinfo', f'{index_mode(path)},{blob},{path}'], check=True)
		print(f'{path}: staged without {len(content.splitlines()) - len(kept)} line(s), worktree untouched')
		return 0
	wanted = sorted({int(value) for value in args})
	for number in wanted:
		if not 1 <= number <= len(hunks):
			raise SystemExit(f'hunk {number} out of range (1..{len(hunks)})')
	patch = b''.join(header) + b''.join(b''.join(hunks[number - 1]) for number in wanted)
	applied = subprocess.run(['git', 'apply', '--cached', '--whitespace=nowarn', '-'], input=patch, capture_output=True)
	sys.stdout.write(applied.stdout.decode('utf-8', 'replace'))
	sys.stderr.write(applied.stderr.decode('utf-8', 'replace'))
	if applied.returncode == 0:
		print(f'{path}: staged hunk(s) {wanted} of {len(hunks)}')
	return applied.returncode


if __name__ == '__main__':
	raise SystemExit(main())
