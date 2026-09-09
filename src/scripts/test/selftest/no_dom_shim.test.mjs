/**
 * DOM shim 地雷自测：`deno test` 子进程给 globalThis.document 赋值必须当场爆炸。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { withNoDomShimPreload } from '../deno/no_dom_shim.mjs'

Deno.test('withNoDomShimPreload only touches deno test commands', () => {
	const trapped = withNoDomShimPreload(['deno', 'test', '--no-check', 'a.test.mjs'])
	assertEquals(trapped[2]?.startsWith('--preload='), true)
	assertEquals(trapped[trapped.length - 1], 'a.test.mjs')
	assertEquals(withNoDomShimPreload(['deno', 'run', 'x.mjs']), ['deno', 'run', 'x.mjs'])
	assertEquals(withNoDomShimPreload(['deno']), ['deno'])
})

Deno.test('deno test child assigning document explodes via no-dom-shim preload', async () => {
	const dir = await Deno.makeTempDir({ prefix: 'fount-no-dom-shim-' })
	const file = join(dir, 'boom.test.mjs')
	await writeFile(file, 'globalThis.document = { head: { prepend() {} } }\nDeno.test("boom", () => {})\n')
	const child = spawn(Deno.execPath(), withNoDomShimPreload([
		'test', '--no-check', '--allow-scripts', '--allow-all',
		'-c', join(REPO_ROOT, 'deno.json'),
		file,
	]), {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env },
	})
	let output = ''
	child.stdout.on('data', chunk => { output += String(chunk) })
	child.stderr.on('data', chunk => { output += String(chunk) })
	try {
		const { exitCode, signal } = await new Promise(resolve => {
			child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
			child.once('error', error => resolve({ exitCode: 1, signal: String(error) }))
		})
		assertEquals((exitCode ?? 1) !== 0 || Boolean(signal), true, '装 DOM shim 的子进程应非零退出')
		assert(output.includes('[fount test] 后端测试禁止安装浏览器 DOM'), `错误指引缺失: ${output.slice(-800)}`)
		assert(output.includes('globalThis.document'), `错误应点名被赋值的全局: ${output.slice(-800)}`)
	}
	finally {
		child.kill()
		await rm(dir, { recursive: true, force: true })
	}
})
