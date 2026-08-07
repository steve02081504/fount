/**
 * path CLI git helpers — bash 可解析性与分支名校验。
 */
/* global Deno */
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const pathSrc = join(REPO_ROOT, 'path', 'src')
const gitSh = join(pathSrc, 'git.sh')

/**
 * 在 bash 中跑一段脚本，返回 { code, stdout, stderr }。
 * @param {string} script bash 源码
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 返回 bash 执行结果
 */
async function runBash(script) {
	const command = new Deno.Command('bash', {
		args: ['-c', script],
		cwd: REPO_ROOT,
		stdout: 'piped',
		stderr: 'piped',
	})
	const { code, stdout, stderr } = await command.output()
	return {
		code,
		stdout: new TextDecoder().decode(stdout),
		stderr: new TextDecoder().decode(stderr),
	}
}

Deno.test('git.sh parses under bash -n', async () => {
	const result = await runBash(`bash -n ${JSON.stringify(gitSh)}`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
})

Deno.test('git_valid_branch_name accepts normal branch names like lava', async () => {
	const result = await runBash(`
		set -e
		# shellcheck source=/dev/null
		. ${JSON.stringify(gitSh)}
		git_valid_branch_name lava
		git_valid_branch_name master
		git_valid_branch_name feature/foo
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('git_valid_branch_name rejects glob and ref-unsafe fragments', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitSh)}
		reject() {
			local name="$1"
			if git_valid_branch_name "$name"; then
				echo "accepted:$name" >&2
				exit 1
			fi
		}
		reject ''
		reject '@'
		reject 'a?b'
		reject 'a*b'
		reject 'a[b'
		reject 'a\\\\b'
		reject 'a:b'
		reject 'a~b'
		reject 'a^b'
		reject 'a..b'
		reject 'a b'
		reject $'a\\tb'
		reject '/abs'
		reject 'trail/'
		reject "a'b"
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'ok')
})

Deno.test('sourcing git.sh defines git_remote_branch_status', async () => {
	const result = await runBash(`
		set -e
		. ${JSON.stringify(gitSh)}
		type git_remote_branch_status >/dev/null
		echo ok
	`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'ok')
})
