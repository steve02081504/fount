/**
 * path CLI git helpers — bash 可解析性与分支名校验。
 */
/* global Deno */
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const gitShPath = join(REPO_ROOT, 'path', 'src', 'git.sh')
const gitPs1Path = join(REPO_ROOT, 'path', 'src', 'git.ps1')
const termuxShPath = join(REPO_ROOT, 'path', 'src', 'unix', 'termux.sh')

/** 应被拒绝的分支名（Git ref 规则 + apostrophe）。 */
const INVALID_BRANCH_NAMES = [
	'',
	'@',
	'a?b',
	'a*b',
	'a[b',
	'a\\b',
	'a:b',
	'a~b',
	'a^b',
	'a..b',
	'a b',
	'a\tb',
	'a\u0001b',
	'/abs',
	'trail/',
	'a//b',
	'.hidden',
	'feat/.hidden',
	'ends.',
	'foo.lock',
	'a/foo.lock',
	'a@{b',
	'a\'b',
]

/** 应被接受的分支名。 */
const VALID_BRANCH_NAMES = ['lava', 'master', 'feature/foo']

/**
 * 将任意字符串编成 base64，便于经 shell 往返时保留控制字符。
 * @param {string} value 任意字符串
 * @returns {string} base64
 */
const encodeBase64 = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(value)))

/**
 * 在 bash 中跑一段脚本，返回 { code, stdout, stderr }。
 * @param {string} script bash 源码
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 返回 bash 执行结果
 */
async function runBash(script) {
	const { code, stdout, stderr } = await new Deno.Command('bash', {
		args: ['-c', script],
		cwd: REPO_ROOT,
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	return {
		code,
		stdout: new TextDecoder().decode(stdout),
		stderr: new TextDecoder().decode(stderr),
	}
}

/**
 * 在 pwsh 中跑一段脚本（仅校验函数，不 dot-source 整文件以免触发安装副作用）。
 * @param {string} script PowerShell 源码
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 执行结果
 */
async function runPwsh(script) {
	const { code, stdout, stderr } = await new Deno.Command(Deno.build.os === 'windows' ? 'powershell' : 'pwsh', {
		args: ['-NoProfile', '-NonInteractive', '-Command', script],
		cwd: REPO_ROOT,
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	return {
		code,
		stdout: new TextDecoder().decode(stdout),
		stderr: new TextDecoder().decode(stderr),
	}
}

/**
 * 从 git.ps1 抽出指定 `function script:NAME` 供隔离测试（去掉 script: 前缀）。
 * @param {string} functionName 函数名（不含 script:）
 * @returns {Promise<string>} 可在 pwsh 中直接执行的函数源码
 */
async function extractPsScriptFn(functionName) {
	const src = await Deno.readTextFile(gitPs1Path)
	const needle = `function script:${functionName}(`
	const start = src.indexOf(needle)
	if (start < 0) throw new Error(`${functionName} not found in git.ps1`)
	let depth = 0
	let end = -1
	let inSingle = false
	for (let characterIndex = start; characterIndex < src.length; characterIndex++) {
		const character = src[characterIndex]
		if (inSingle) {
			if (character === '\'' && src[characterIndex + 1] === '\'') {
				characterIndex++
				continue
			}
			if (character === '\'') inSingle = false
			continue
		}
		if (character === '\'') {
			inSingle = true
			continue
		}
		if (character === '{') depth++
		else if (character === '}') {
			depth--
			if (depth === 0) {
				end = characterIndex + 1
				break
			}
		}
	}
	if (end < 0) throw new Error(`${functionName} brace mismatch in git.ps1`)
	return src.slice(start, end).replace(`function script:${functionName}`, `function ${functionName}`)
}

/**
 * @returns {Promise<string>} git_valid_branch_name 源码
 */
const extractPsValidBranchFn = () => extractPsScriptFn('git_valid_branch_name')

/**
 * @returns {Promise<string>} git_parse_pr_number 源码
 */
const extractPsParsePrFn = () => extractPsScriptFn('git_parse_pr_number')


Deno.test('git.sh parses under bash -n', async () => {
	const result = await runBash(`bash -n ${JSON.stringify(gitShPath)}`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
})

Deno.test('git_valid_branch_name accepts normal branch names like lava', async () => {
	const result = await runBash(`
		set -e
		# shellcheck source=/dev/null
		. ${JSON.stringify(gitShPath)}
		for name in ${VALID_BRANCH_NAMES.map(branchName => JSON.stringify(branchName)).join(' ')}; do
			git_valid_branch_name "$name"
		done
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('git_valid_branch_name rejects glob and ref-unsafe fragments (bash)', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		decode() { printf '%s' "$1" | base64 -d; }
		reject() {
			local name="$1"
			if git_valid_branch_name "$name"; then
				echo "accepted:$name" >&2
				exit 1
			fi
		}
		for base64Name in ${INVALID_BRANCH_NAMES.map(encodeBase64).map(base64Name => JSON.stringify(base64Name)).join(' ')}; do
			reject "$(decode "$base64Name")"
		done
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('git_valid_branch_name bash and PowerShell agree', async () => {
	const allNames = [...VALID_BRANCH_NAMES, ...INVALID_BRANCH_NAMES]
	const encoded = allNames.map(encodeBase64)

	const bash = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		decode() { printf '%s' "$1" | base64 -d; }
		for base64Name in ${encoded.map(base64Name => JSON.stringify(base64Name)).join(' ')}; do
			if git_valid_branch_name "$(decode "$base64Name")"; then echo 1; else echo 0; fi
		done
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)

	const powerShellResult = await runPwsh(`
${await extractPsValidBranchFn()}
$encoded = @(${encoded.map(base64Name => `'${base64Name}'`).join(', ')})
foreach ($base64Name in $encoded) {
  $ok = if (git_valid_branch_name ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64Name)))) { '1' } else { '0' }
  Write-Output $ok
}
`)
	assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)

	const bashVerdicts = bash.stdout.trim().split(/\r?\n/).filter(Boolean)
	const psVerdicts = powerShellResult.stdout.trim().split(/\r?\n/).filter(Boolean)
	assertEquals(psVerdicts.length, allNames.length)
	assertEquals(bashVerdicts.length, allNames.length)
	assertEquals(psVerdicts, bashVerdicts)
})

Deno.test('git_valid_branch_name rejects control characters (bash and PowerShell)', async () => {
	const base64Name = encodeBase64('a\u0001b')
	const bash = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		if git_valid_branch_name "$(printf '%s' ${JSON.stringify(base64Name)} | base64 -d)"; then
			echo accepted >&2
			exit 1
		fi
		echo ok
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)
	assertEquals(bash.stdout.trim(), 'ok')

	const powerShellResult = await runPwsh(`
${await extractPsValidBranchFn()}
if (git_valid_branch_name ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Name}')))) { Write-Error 'accepted'; exit 1 }
Write-Output ok
`)
	assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)
	assertEquals(powerShellResult.stdout.trim(), 'ok')
})

Deno.test('sourcing git.sh defines git_remote_branch_status', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		type git_remote_branch_status >/dev/null
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'ok')
})

/** 合法的 PR 目标形式，对应期望的编号。 */
const VALID_PR_TARGETS = [
	['pr/42', '42'],
	['PR/7', '7'],
	['pull/99', '99'],
	['Pull/1', '1'],
	['#123', '123'],
	['https://github.com/steve02081504/fount/pull/580', '580'],
	['https://github.com/steve02081504/fount/pull/580/files', '580'],
	['http://github.com/o/r/pull/3?x=1', '3'],
]

/** 被拒绝的 PR 目标形式。 */
const INVALID_PR_TARGETS = [
	'',
	'pr/',
	'pr/0x1',
	'pr/12/3',
	'pr/12a',
	'pr/١', // Unicode digit — must stay rejected (ASCII [0-9] only)
	'pull/',
	'#',
	'#abc',
	'42',
	'branch',
	'https://github.com/o/r/issues/1',
	'https://gitlab.com/o/r/pull/1',
	'https://github.com/o/pull/1',
]

Deno.test('git_parse_pr_number accepts pr/N pull/N #N and GitHub URLs (bash)', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		${VALID_PR_TARGETS.map(([target, number]) => `
			got=$(git_parse_pr_number ${JSON.stringify(target)})
			[ "$got" = ${JSON.stringify(number)} ] || { echo "mismatch:${target}:$got" >&2; exit 1; }
		`).join('')}
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('git_parse_pr_number rejects non-PR targets (bash)', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		decode() { printf '%s' "$1" | base64 -d; }
		for base64Name in ${INVALID_PR_TARGETS.map(encodeBase64).map(base64Name => JSON.stringify(base64Name)).join(' ')}; do
			if git_parse_pr_number "$(decode "$base64Name")" >/dev/null; then
				echo "accepted:$(decode "$base64Name")" >&2
				exit 1
			fi
		done
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('git_parse_pr_number bash and PowerShell agree', async () => {
	const allTargets = [
		...VALID_PR_TARGETS.map(([target]) => target),
		...INVALID_PR_TARGETS,
	]
	const encoded = allTargets.map(encodeBase64)

	const bash = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		decode() { printf '%s' "$1" | base64 -d; }
		for base64Name in ${encoded.map(base64Name => JSON.stringify(base64Name)).join(' ')}; do
			if out=$(git_parse_pr_number "$(decode "$base64Name")"); then echo "1:$out"; else echo 0; fi
		done
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)

	const powerShellResult = await runPwsh(`
${await extractPsParsePrFn()}
$encoded = @(${encoded.map(base64Name => `'${base64Name}'`).join(', ')})
foreach ($base64Name in $encoded) {
  $got = git_parse_pr_number ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64Name)))
  if ($null -ne $got -and $got -ne '') { Write-Output ("1:" + $got) } else { Write-Output '0' }
}
`)
	assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)

	const bashVerdicts = bash.stdout.trim().split(/\r?\n/).filter(Boolean)
	const psVerdicts = powerShellResult.stdout.trim().split(/\r?\n/).filter(Boolean)
	assertEquals(psVerdicts.length, allTargets.length)
	assertEquals(bashVerdicts.length, allTargets.length)
	assertEquals(psVerdicts, bashVerdicts)
})

/**
 * 单分支 clone + one-shot fetch 场景：`branch --set-upstream-to` 会 fatal；
 * git_checkout_branch 必须补上该 head 的 fetch refspec（非 *）并建好 @{u}。
 */
Deno.test('git_checkout_branch tracks one-shot origin ref under single-branch fetch', async () => {
	const allHeadsFetchRe = String.raw`^(\+)?refs/heads/\*:refs/remotes/origin/\*$`
	const result = await runBash(`
		set -euo pipefail
		temporaryDirectory=$(mktemp -d)
		cleanup() { rm -rf "$temporaryDirectory"; }
		trap cleanup EXIT

		git init --bare -b master "$temporaryDirectory/remote.git" >/dev/null
		git clone "$temporaryDirectory/remote.git" "$temporaryDirectory/seed" >/dev/null 2>&1
		cd "$temporaryDirectory/seed"
		git config user.email t@t
		git config user.name t
		echo master > f.txt
		git add f.txt && git commit -m master >/dev/null
		git push origin master >/dev/null
		git checkout -b lava >/dev/null 2>&1
		echo lava > f.txt
		git add f.txt && git commit -m lava >/dev/null
		git push origin lava >/dev/null

		git clone --single-branch --branch master "$temporaryDirectory/remote.git" "$temporaryDirectory/clone" >/dev/null 2>&1
		cd "$temporaryDirectory/clone"
		git config user.email t@t
		git config user.name t

		FOUNT_DIR="$temporaryDirectory/clone"
		print_i18n_yellow() { :; }
		print_i18n_green() { :; }
		. ${JSON.stringify(gitShPath)}

		git_fetch_remote_branch lava
		# Reproduce: raw --set-upstream-to must fail on this clone shape.
		if git branch --set-upstream-to origin/lava lava >/dev/null 2>&1; then
			echo 'expected set-upstream-to to fail' >&2
			exit 1
		fi

		git_checkout_branch lava origin/lava
		upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')
		[ "$upstream" = 'origin/lava' ] || { echo "upstream=$upstream" >&2; exit 1; }
		fetch_specs=$(git config --get-all remote.origin.fetch)
		printf '%s\\n' "$fetch_specs" | grep -qE ${JSON.stringify(allHeadsFetchRe)} && {
			echo "fetch widened to all heads:" >&2
			printf '%s\\n' "$fetch_specs" >&2
			exit 1
		}
		printf '%s\\n' "$fetch_specs" | grep -qxF '+refs/heads/lava:refs/remotes/origin/lava' || {
			echo "lava refspec missing:" >&2
			printf '%s\\n' "$fetch_specs" >&2
			exit 1
		}
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

/**
 * fount_show_version：本地 tip / 落后 / 分离 HEAD 状态键。
 */
Deno.test('fount_show_version reports branch sha and freshness', async () => {
	const result = await runBash(`
		set -euo pipefail
		temporaryDirectory=$(mktemp -d)
		cleanup() { rm -rf "$temporaryDirectory"; }
		trap cleanup EXIT

		git init --bare -b master "$temporaryDirectory/remote.git" >/dev/null
		git clone "$temporaryDirectory/remote.git" "$temporaryDirectory/seed" >/dev/null 2>&1
		cd "$temporaryDirectory/seed"
		git config user.email t@t
		git config user.name t
		echo v1 > f.txt
		git add f.txt && git commit -m v1 >/dev/null
		git push origin master >/dev/null

		git clone "$temporaryDirectory/remote.git" "$temporaryDirectory/clone" >/dev/null 2>&1
		cd "$temporaryDirectory/clone"
		git config user.email t@t
		git config user.name t

		FOUNT_DIR="$temporaryDirectory/clone"
		get_i18n() { printf '%s' "$1"; shift; while [ $# -gt 0 ]; do printf ' %s=%s' "$1" "$2"; shift 2; done; printf '\\n'; }
		print_i18n_green() { get_i18n "$@"; }
		print_i18n_yellow() { get_i18n "$@" >&2; }
		. ${JSON.stringify(gitShPath)}

		commitHash=$(git rev-parse HEAD)
		output=$(fount_show_version)
		printf '%s\\n' "$output" | grep -qxF "version.branch.title branch=master" || { echo "branch line:" >&2; printf '%s\\n' "$output" >&2; exit 1; }
		printf '%s\\n' "$output" | grep -qxF "version.commit ref=$commitHash" || { echo "commit line:" >&2; printf '%s\\n' "$output" >&2; exit 1; }
		printf '%s\\n' "$output" | grep -qxF "version.status.title status=version.status.upToDate" || { echo "expected upToDate:" >&2; printf '%s\\n' "$output" >&2; exit 1; }

		cd "$temporaryDirectory/seed"
		echo v2 > f.txt
		git add f.txt && git commit -m v2 >/dev/null
		git push origin master >/dev/null

		cd "$temporaryDirectory/clone"
		output=$(fount_show_version 2>&1)
		printf '%s\\n' "$output" | grep -qxF "version.status.title status=version.status.behind" || { echo "expected behind:" >&2; printf '%s\\n' "$output" >&2; exit 1; }

		git checkout --detach HEAD >/dev/null 2>&1
		: >"$FOUNT_DIR/.noupdate"
		output=$(fount_show_version)
		printf '%s\\n' "$output" | grep -qxF "version.branch.title branch=version.branch.detached" || { echo "expected detached:" >&2; printf '%s\\n' "$output" >&2; exit 1; }
		printf '%s\\n' "$output" | grep -qxF "version.autoUpdatePaused" || { echo "expected autoUpdatePaused:" >&2; printf '%s\\n' "$output" >&2; exit 1; }
		printf '%s\\n' "$output" | grep -qxF "version.status.title status=version.status.detachedNoCompare" || { echo "expected detachedNoCompare:" >&2; printf '%s\\n' "$output" >&2; exit 1; }
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

/** BCP 47 → POSIX LANG 用例（Android/Termux）。 */
const ANDROID_LOCALE_TO_LANG = [
	['zh-Hans-CN', 'zh_CN.UTF-8'],
	['zh-CN', 'zh_CN.UTF-8'],
	['zh_CN', 'zh_CN.UTF-8'],
	['en-US', 'en_US.UTF-8'],
	['ja-JP', 'ja_JP.UTF-8'],
	['en', 'en.UTF-8'],
]

Deno.test('android_locale_to_lang normalizes BCP47 script tags for Termux LANG', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(termuxShPath)}
		${ANDROID_LOCALE_TO_LANG.map(([tag, want]) => `
			actualLang=$(android_locale_to_lang ${JSON.stringify(tag)})
			[ "$actualLang" = ${JSON.stringify(want)} ] || { echo "mismatch:${tag}:$actualLang" >&2; exit 1; }
		`).join('')}
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('android_locale_to_lang feeds get_system_locales toward zh-CN', async () => {
	const i18nShPath = join(REPO_ROOT, 'path', 'src', 'i18n.sh')
	const result = await runBash(`
		set -e
		FOUNT_DIR=${JSON.stringify(REPO_ROOT)}
		. ${JSON.stringify(termuxShPath)}
		. ${JSON.stringify(i18nShPath)}
		LANG=$(android_locale_to_lang 'zh-Hans-CN')
		export LANG
		unset LC_ALL
		system_locales=$(get_system_locales)
		available_locales=$(get_available_locales)
		best=$(get_best_locale "$system_locales" "$available_locales")
		[ "$best" = 'zh-CN' ] || { echo "best=$best system=$system_locales" >&2; exit 1; }
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})
