/* global Deno */
/**
 * 文件操作 · glob/grep 搜索（ripgrep WASM）单元测试。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { fileOperationsReplyHandler } from '../../../../plugins/file-operations/handler.mjs'
import { runRipgrep } from '../../../../plugins/file-operations/src/search.mjs'
import { createTargetExecutor } from '../../../../plugins/file-operations/src/target.mjs'

/**
 * 在临时工作区写入搜索用的测试文件。
 * @param {string} root - 工作区根。
 * @returns {Promise<void>}
 */
async function seedWorkspace(root) {
	await fs.mkdir(path.join(root, 'sub'), { recursive: true })
	await fs.writeFile(path.join(root, 'a.mjs'), 'hello world\nconst x = () => 1\nTODO fix\n')
	await fs.writeFile(path.join(root, 'b.txt'), 'nothing here\nTODO too\n')
	await fs.writeFile(path.join(root, 'sub', 'c.mjs'), 'deep hello\n')
}

/**
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_search_'))
}

/**
 * 构造 handler 调用参数，收集回写日志。
 * @param {string} root - 工作区根。
 * @returns {{logs: object[], args: object}} 日志数组与参数。
 */
function createHandlerArgs(root) {
	const logs = []
	/**
	 * 收集工具回写日志。
	 * @param {object} entry - 日志条目。
	 * @returns {void}
	 */
	const addLog = entry => { logs.push(entry) }
	return {
		logs,
		args: {
			Charname: 'TestChar',
			username: 'test-user',
			workdir: { machine: '0', path: root },
			chat_scoped_char_memory: {},
			AddLongTimeLog: addLog,
		},
	}
}

Deno.test('local executor resolvePath resolves against workdir', async () => {
	const root = await tempDir()
	try {
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		assertEquals(await executor.resolvePath('sub/c.mjs'), path.join(root, 'sub', 'c.mjs'))
		assertEquals(await executor.resolvePath(''), path.resolve(root))
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob lists matching files relative to root', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const result = await executor.execJs(runRipgrep, { mode: 'glob', root, patterns: ['**/*.mjs'], limit: 10 })
		assertEquals(result.ok, true)
		assertEquals(result.files, ['a.mjs', 'sub/c.mjs'])
		assertEquals(result.total, 2)
		assertEquals(result.truncated, false)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob truncates at limit', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'glob', root, patterns: ['**/*'], limit: 1 })
		assertEquals(result.ok, true)
		assertEquals(result.files.length, 1)
		assertEquals(result.total, 3)
		assertEquals(result.truncated, true)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep grep returns matches with line numbers and honors include', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', includes: ['*.mjs'], limit: 10 })
		assertEquals(result.ok, true)
		assertEquals(result.matches, [
			{ path: 'a.mjs', line: 1, text: 'hello world' },
			{ path: 'sub/c.mjs', line: 1, text: 'deep hello' },
		])
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep grep filesOnly lists matching files', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', filesOnly: true, limit: 10 })
		assertEquals(result.ok, true)
		assertEquals(result.files, ['a.mjs', 'sub/c.mjs'])
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep reports invalid regex as an error result', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: '(unclosed', limit: 10 })
		assertEquals(result.ok, false)
		assert(result.error.includes('regex'), `error should mention regex: ${result.error}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('fileOperationsReplyHandler executes <glob> and <grep> tags', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)

		const globRun = createHandlerArgs(root)
		assertEquals(await fileOperationsReplyHandler({ content: '<glob path=".">**/*.mjs</glob>', content_for_handle: '<glob path=".">**/*.mjs</glob>' }, globRun.args), true)
		const globContent = globRun.logs.map(entry => entry.content).join('\n')
		assert(globContent.includes('a.mjs') && globContent.includes('sub/c.mjs'), `glob output: ${globContent}`)

		const grepRun = createHandlerArgs(root)
		assertEquals(await fileOperationsReplyHandler({ content: '<grep include="*.mjs">hello</grep>', content_for_handle: '<grep include="*.mjs">hello</grep>' }, grepRun.args), true)
		const grepContent = grepRun.logs.map(entry => entry.content).join('\n')
		assert(grepContent.includes('a.mjs:') && grepContent.includes('1: hello world'), `grep output: ${grepContent}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('fileOperationsReplyHandler gives grep/glob tool entries a human content_for_show layer', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)

		const globRun = createHandlerArgs(root)
		await fileOperationsReplyHandler({ content: '<glob path=".">**/*.mjs</glob>', content_for_handle: '<glob path=".">**/*.mjs</glob>' }, globRun.args)
		const globEntry = globRun.logs.find(entry => entry.role === 'tool' && entry.name === 'file-operations.glob')
		assert(globEntry, 'glob tool entry should exist')
		assert(globEntry.content_for_show, 'glob tool entry should have content_for_show')
		assert(globEntry.content_for_show !== globEntry.content, 'show layer should differ from agent layer')
		assert(globEntry.content_for_show.includes('**/*.mjs'), `glob show layer should keep the executed pattern: ${globEntry.content_for_show}`)
		assert(globEntry.content_for_show.includes('a.mjs'), `glob show layer should keep the result: ${globEntry.content_for_show}`)

		const grepRun = createHandlerArgs(root)
		await fileOperationsReplyHandler({ content: '<grep include="*.mjs">hello</grep>', content_for_handle: '<grep include="*.mjs">hello</grep>' }, grepRun.args)
		const grepEntry = grepRun.logs.find(entry => entry.role === 'tool' && entry.name === 'file-operations.grep')
		assert(grepEntry, 'grep tool entry should exist')
		assert(grepEntry.content_for_show, 'grep tool entry should have content_for_show')
		assert(grepEntry.content_for_show !== grepEntry.content, 'show layer should differ from agent layer')
		assert(grepEntry.content_for_show.includes('hello'), `grep show layer should keep the pattern: ${grepEntry.content_for_show}`)
		assert(grepEntry.content_for_show.includes('a.mjs:'), `grep show layer should keep the result: ${grepEntry.content_for_show}`)

		// handler 不再以 char 角色重放调用：只追加工具结果日志（原始生成入日志由管线负责）
		assert(!grepRun.logs.some(entry => entry.role === 'char'), 'handler should only append tool result logs')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
