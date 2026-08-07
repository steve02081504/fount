/**
 * path CLI git helpers — bash 可解析性与分支名校验。
 */
/* global Deno */
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const gitShPath = join(REPO_ROOT, 'path', 'src', 'git.sh')
const gitPs1Path = join(REPO_ROOT, 'path', 'src', 'git.ps1')

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
	const encoded = INVALID_BRANCH_NAMES.map(encodeBase64)
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
		for b64 in ${encoded.map(encodedName => JSON.stringify(encodedName)).join(' ')}; do
			reject "$(decode "$b64")"
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
		for b64 in ${encoded.map(encodedName => JSON.stringify(encodedName)).join(' ')}; do
			name=$(decode "$b64")
			if git_valid_branch_name "$name"; then echo 1; else echo 0; fi
		done
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)

	const powerShellResult = await runPwsh(`
${await extractPsValidBranchFn()}
$encoded = @(${encoded.map(encodedName => `'${encodedName}'`).join(', ')})
foreach ($b64 in $encoded) {
  $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  $ok = if (git_valid_branch_name $name) { '1' } else { '0' }
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
	const controlBranch = 'a\u0001b'
	const b64 = encodeBase64(controlBranch)
	const bash = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		name=$(printf '%s' ${JSON.stringify(b64)} | base64 -d)
		if git_valid_branch_name "$name"; then
			echo accepted >&2
			exit 1
		fi
		echo ok
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)
	assertEquals(bash.stdout.trim(), 'ok')

	const powerShellResult = await runPwsh(`
${await extractPsValidBranchFn()}
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
if (git_valid_branch_name $name) { Write-Error 'accepted'; exit 1 }
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

/** Accepted PR target forms → expected number. */
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

/** Rejected PR target forms. */
const INVALID_PR_TARGETS = [
	'',
	'pr/',
	'pr/0x1',
	'pr/12/3',
	'pr/12a',
	'pull/',
	'#',
	'#abc',
	'42',
	'branch',
	'https://github.com/o/r/issues/1',
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
	const encoded = INVALID_PR_TARGETS.map(encodeBase64)
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		decode() { printf '%s' "$1" | base64 -d; }
		for b64 in ${encoded.map(encodedName => JSON.stringify(encodedName)).join(' ')}; do
			name=$(decode "$b64")
			if git_parse_pr_number "$name" >/dev/null; then
				echo "accepted:$name" >&2
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
		for b64 in ${encoded.map(encodedName => JSON.stringify(encodedName)).join(' ')}; do
			name=$(decode "$b64")
			if out=$(git_parse_pr_number "$name"); then echo "1:$out"; else echo 0; fi
		done
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)

	const powerShellResult = await runPwsh(`
${await extractPsParsePrFn()}
$encoded = @(${encoded.map(encodedName => `'${encodedName}'`).join(', ')})
foreach ($b64 in $encoded) {
  $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  $got = git_parse_pr_number $name
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
