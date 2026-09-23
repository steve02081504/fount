/* global Deno */
/**
 * 文件操作 · 读取时向上上下文（AGENTS.md / .agents/docs）内容哈希去重单元测试。
 * 覆盖：跨轮（靠日志 extension.loadedContextHashes）、分页非首页、摘要边界重置。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { fileOperationsReplyHandlers } from '../../../../plugins/file-operations/handler.mjs'
import { runReplyHandlers } from '../../../chat/src/reply/handlerPipeline.mjs'

/**
 * 通过回复管线运行文件操作 handler。
 * @param {string} content 原始生成
 * @param {object} args 请求上下文
 * @returns {Promise<boolean>} 是否建议重新生成
 */
async function runFileOps(content, args) {
	return runReplyHandlers({ content, extension: {} }, args, fileOperationsReplyHandlers)
}

/**
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_dedup_'))
}

/**
 * 构造最小可用 prompt_struct。
 * @param {string} charId 角色 id
 * @returns {object} prompt_struct
 */
function makePromptStruct(charId) {
	return {
		char_id: charId,
		username: 'test-user',
		member_roles: [],
		chat_log: [],
		user_prompt: { additional_chat_log: [] },
		world_prompt: { additional_chat_log: [] },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
		char_prompt: { additional_chat_log: [] },
	}
}

/**
 * 构造 handler 参数，模拟模板：工具日志同时进入收集数组与本轮 additional_chat_log。
 * @param {string} root 工作区根
 * @returns {{logs: object[], args: object}} 日志数组与参数
 */
function createHandlerArgs(root) {
	const logs = []
	const prompt_struct = makePromptStruct('TestChar')
	/**
	 * 收集工具回写日志。
	 * @param {object} entry 日志条目
	 * @returns {void}
	 */
	const addLog = entry => {
		entry.charVisibility ??= ['TestChar']
		logs.push(entry)
		prompt_struct.char_prompt.additional_chat_log.push(entry)
	}
	return {
		logs,
		args: {
			Charname: 'TestChar',
			username: 'test-user',
			char_id: 'TestChar',
			workdir: { machine: '0', path: root },
			chat_scoped_char_memory: {},
			prompt_struct,
			AddLongTimeLog: addLog,
		},
	}
}

/**
 * 取该次读取追加的工具日志。
 * @param {object[]} logs 日志数组
 * @returns {object|undefined} 工具日志条目
 */
function viewEntry(logs) {
	return logs.find(entry => entry.name === 'file-operations.view-file')
}

/**
 * 播种工作区：两级 AGENTS.md + 一个文件。
 * @param {string} root 工作区根
 * @returns {Promise<string>} 目标文件绝对路径
 */
async function seedWorkspace(root) {
	await fs.mkdir(path.join(root, 'src', 'deep'), { recursive: true })
	await fs.writeFile(path.join(root, 'AGENTS.md'), '# root rules', 'utf8')
	await fs.writeFile(path.join(root, 'src', 'AGENTS.md'), '# src rules', 'utf8')
	const file = path.join(root, 'src', 'deep', 'a.ts')
	await fs.writeFile(file, 'export {}\n', 'utf8')
	return file
}

Deno.test('view-file 首次读取注入两级 AGENTS.md 并在 extension 预存内容哈希', async () => {
	const root = await tempDir()
	try {
		const file = await seedWorkspace(root)
		const run = createHandlerArgs(root)
		await runFileOps(`<view-file>${file}</view-file>`, run.args)

		const entry = viewEntry(run.logs)
		assert(entry, '应追加 view-file 工具日志')
		assert(entry.content.includes('随文件一并加载的上下文'), '首次读取应注入上下文')
		assert(entry.content.includes('# root rules') && entry.content.includes('# src rules'))
		assertEquals(entry.extension.loadedContextHashes.length, 2, '两级 AGENTS.md 各预存一个哈希')
		for (const hash of entry.extension.loadedContextHashes)
			assert(/^[0-9a-f]{64}$/.test(hash), `应为 sha256 hex：${hash}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('view-file does not repeat the opened AGENTS.md as its own upward context', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const run = createHandlerArgs(root)
		await runFileOps(`<view-file>${path.join(root, 'AGENTS.md')}</view-file>`, run.args)
		const entry = viewEntry(run.logs)
		assertEquals(entry.content.split('# root rules').length - 1, 1)
		assert(!entry.content.includes('随文件一并加载的上下文'))
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('view-file skips workspace rules already injected by the code world', async () => {
	const root = await tempDir()
	try {
		const file = await seedWorkspace(root)
		const run = createHandlerArgs(root)
		run.args.prompt_struct.world_prompt.text = [{ description: `AGENTS.md (${path.join(root, 'AGENTS.md')})`, content: '# root rules' }]
		await runFileOps(`<view-file>${file}</view-file>`, run.args)
		const entry = viewEntry(run.logs)
		assert(!entry.content.includes('# root rules'))
		assert(entry.content.includes('# src rules'))
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('view-file 跨轮读取同一文件：生效窗口内已注入过的上下文不再重复注入', async () => {
	const root = await tempDir()
	try {
		const file = await seedWorkspace(root)

		const first = createHandlerArgs(root)
		await runFileOps(`<view-file>${file}</view-file>`, first.args)
		const firstEntry = viewEntry(first.logs)

		// 模拟下一轮：新的请求上下文，但携带上一轮的工具日志
		const second = createHandlerArgs(root)
		second.args.prompt_struct.char_prompt.additional_chat_log.push(firstEntry)
		await runFileOps(`<view-file>${file}</view-file>`, second.args)

		const secondEntry = viewEntry(second.logs)
		assert(!secondEntry.content.includes('随文件一并加载的上下文'), '已注入过的上下文应被跳过')
		assert(secondEntry.content.includes('export {}'), '文件正文仍应正常返回')
		assert(!secondEntry.extension, '无新注入时不写哈希扩展字段')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('view-file 非首页（offset 非 1）读取同样注入上下文', async () => {
	const root = await tempDir()
	try {
		const file = await seedWorkspace(root)
		const run = createHandlerArgs(root)
		await runFileOps(`<view-file offset="5">${file}</view-file>`, run.args)

		const entry = viewEntry(run.logs)
		assert(entry.content.includes('随文件一并加载的上下文'), '移除首页判定后任意页读取都应注入')
		assertEquals(entry.extension.loadedContextHashes.length, 2)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('view-file 摘要边界：summary 之前的注入不再算数，summary 之后的仍生效', async () => {
	const root = await tempDir()
	try {
		const file = await seedWorkspace(root)

		// 先制造一条带哈希的工具日志
		const seed = createHandlerArgs(root)
		await runFileOps(`<view-file>${file}</view-file>`, seed.args)
		const priorEntry = viewEntry(seed.logs)

		const summaryEntry = { id: 'summary-1', name: 'summary', uid: 'system', role: 'system', type: 'summary', content: '历史摘要', charVisibility: ['TestChar'] }

		// summary 在前、旧日志在后 → 旧日志应被边界排除，需要重新注入
		const before = createHandlerArgs(root)
		before.args.prompt_struct.chat_log.push({ ...priorEntry, id: 'prior' }, summaryEntry)
		await runFileOps(`<view-file>${file}</view-file>`, before.args)
		assert(viewEntry(before.logs).content.includes('随文件一并加载的上下文'), 'summary 之前的日志应被排除并重新注入')

		// summary 在前、旧日志在后（summary 之前的 base log 已收敛）→ 命中边界之后的哈希，跳过注入
		const after = createHandlerArgs(root)
		after.args.prompt_struct.chat_log.push(summaryEntry, { ...priorEntry, id: 'prior-2' })
		await runFileOps(`<view-file>${file}</view-file>`, after.args)
		assert(!viewEntry(after.logs).content.includes('随文件一并加载的上下文'), 'summary 之后仍生效的日志应命中哈希并跳过')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
