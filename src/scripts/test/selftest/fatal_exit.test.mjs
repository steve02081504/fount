/**
 * env.mjs fatal 事件须置 exitCode=1：否则 on-shutdown beforeExit 会以 0 退出，
 * live runner 的 worker 启动失败会被编排器标成「通过但有噪声」。
 */
/* global Deno */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { childEnv } from '../env.mjs'

/**
 * 在临时脚本里导入 env.mjs 后触发 fatal，断言子进程退出码。
 * @param {string} body 紧接 env import 之后的脚本正文
 * @returns {Promise<number>} 子进程退出码
 */
async function runFatalScript(body) {
	const dir = await mkdtemp(join(tmpdir(), 'fount_fatal_exit_'))
	const script = join(dir, 'fatal.mjs')
	await writeFile(script, `import 'fount/scripts/test/env.mjs'\n${body}\n`, 'utf8')
	try {
		const child = new Deno.Command(Deno.execPath(), {
			args: ['run', '--allow-scripts', '--allow-all', '-c', './deno.json', script],
			cwd: REPO_ROOT,
			env: childEnv(),
			stdout: 'piped',
			stderr: 'piped',
		})
		const { code } = await child.output()
		return code
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
}

Deno.test('env.mjs unhandledRejection exits non-zero', async () => {
	const code = await runFatalScript('void Promise.reject(new Error("fatal-rejection-probe"))')
	assertEquals(code, 1)
})

Deno.test('env.mjs uncaughtException exits non-zero', async () => {
	const code = await runFatalScript('queueMicrotask(() => { throw new Error("fatal-exception-probe") })')
	assertEquals(code, 1)
})
