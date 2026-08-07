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
 * 从 git.ps1 抽出 git_valid_branch_name 函数体供隔离测试。
 * @returns {Promise<string>} 函数源码（script: 前缀已去掉）
 */
async function extractPsValidBranchFn() {
	const src = await Deno.readTextFile(gitPs1Path)
	const start = src.indexOf('function script:git_valid_branch_name($Branch) {')
	if (start < 0) throw new Error('git_valid_branch_name not found in git.ps1')
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
	if (end < 0) throw new Error('git_valid_branch_name brace mismatch in git.ps1')
	return src.slice(start, end).replace('function script:git_valid_branch_name', 'function git_valid_branch_name')
}

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
		reject() {
			local name="$1"
			if git_valid_branch_name "$name"; then
				echo "accepted:$name" >&2
				exit 1
			fi
		}
		${INVALID_BRANCH_NAMES.map(branchName => `reject ${JSON.stringify(branchName)}`).join('\n')}
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('git_valid_branch_name bash and PowerShell agree', async () => {
	const allNames = [...VALID_BRANCH_NAMES, ...INVALID_BRANCH_NAMES]
	/**
	 * @param {string} value 任意字符串
	 * @returns {string} base64
	 */
	const encodeBase64 = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(value)))
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
	const bash = await runBash(`
		set -e
		. ${JSON.stringify(gitShPath)}
		if git_valid_branch_name ${JSON.stringify(controlBranch)}; then
			echo accepted >&2
			exit 1
		fi
		echo ok
	`)
	assertEquals(bash.code, 0, bash.stderr || bash.stdout)
	assertEquals(bash.stdout.trim(), 'ok')

	const encodeBase64 = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(value)))
	const powerShellResult = await runPwsh(`
${await extractPsValidBranchFn()}
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodeBase64(controlBranch)}'))
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
