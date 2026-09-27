/* global Deno */
/**
 * code shell 预读流程端到端集成测试：
 * BeforeReply 在首次 StructCall 前预读提及文件（无需额外重生成轮次）、
 * 会话持久化插件私有数据 `pluginData` 与 `charVisibility`、跨轮去重、重生成重跑钩子。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { sessionStream } from './helpers/code_http.mjs'

/**
 * 启动仅加载 code shell 的测试节点。
 * @param {object} [options] 透传给 launchNode 的额外选项。
 * @returns {Promise<object>} 测试节点。
 */
async function launchCodeNode(options = {}) {
	return await launchNode({
		username: 'code-preload-user',
		apiKey: `fount-code-preload-${Date.now().toString(36)}`,
		loadParts: ['shells/code'],
		p2p: false,
		minP2pNode: true,
		...options,
	})
}

/**
 * 读取 fixture 记录的首轮额外日志观测。
 * @param {string} root - 工作区根。
 * @returns {Promise<object[]>} 每次 GetReply 一条观测记录。
 */
async function readObservations(root) {
	const text = await fs.readFile(path.join(root, 'preload_observations.jsonl'), 'utf8')
	return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/**
 * 从工作区读取落盘会话。
 * @param {string} root - 工作区根。
 * @param {string} id - 会话 id。
 * @returns {Promise<object>} 会话对象。
 */
async function readSession(root, id) {
	return JSON.parse(await fs.readFile(path.join(root, '.fount', 'code', 'sessions', id + '.json'), 'utf8'))
}

Deno.test({
	name: 'BeforeReply preloads mentioned files before the first round, persists pluginData/charVisibility and stays idempotent',
	timeout: 120_000,
}, async () => {
	const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wsPreloadChar')
	const node = await launchCodeNode({ fixtureCopies: [{ from: fixtureDir, to: 'chars/wsPreloadChar' }] })
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_preload_'))
	try {
		const fileName = 'preload_target.txt'
		await fs.writeFile(path.join(root, fileName), 'PRELOAD_MARKER_CONTENT', 'utf8')
		const now = new Date().toISOString()
		const session = {
			id: 'preload01', title: '', charname: 'wsPreloadChar', profile: '', ai_source: '',
			created: now, updated: now, memory: {},
			entries: [{ id: 'p-u1', uid: 'user', role: 'user', name: node.username, content: `请阅读 ./${fileName}`, time: now, files: [] }],
		}
		const { done } = await sessionStream(node, {
			type: 'send', session, machine: '0', workdir: root,
			ai_source: '', profile: '', content: `请阅读 ./${fileName}`, files: [], clientEntryId: 'p-u1',
		})
		assertEquals(done.type, 'done', `expected done, got ${JSON.stringify(done).slice(0, 300)}`)

		// 首轮 StructCall 已见预读内容，且不产生额外重生成轮次
		const observations = await readObservations(root)
		assertEquals(observations.length, 1, '首次生成只应调用一次 GetReply')
		assert(
			observations[0].additionalChatLog.some(entry => String(entry.content).includes('PRELOAD_MARKER_CONTENT')),
			`首轮合并 prompt 应含预读文件内容：${JSON.stringify(observations[0].additionalChatLog).slice(0, 400)}`
		)
		assertEquals(done.entries.filter(entry => entry.role === 'char').length, 1, '预读不得触发额外的重生成轮次')
		assert(!done.entries.some(entry => entry.name === 'file-operations.view-file'), '预读后不应再调用 view-file')

		// 持久化：预读工具条目带 charVisibility 与 pluginData
		const saved = await readSession(root, session.id)
		const preloadEntries = saved.entries.filter(entry => entry.role === 'tool' && entry.extension?.pluginData)
		assertEquals(preloadEntries.length, 1, `会话应持久化一条带 pluginData 的预读条目：${JSON.stringify(saved.entries.map(entry => ({ name: entry.name, extension: entry.extension }))).slice(0, 400)}`)
		assert(preloadEntries[0].content.includes('PRELOAD_MARKER_CONTENT'), '预读条目应含文件内容')
		assert(Array.isArray(preloadEntries[0].charVisibility) && preloadEntries[0].charVisibility.length, '预读条目应带 charVisibility')
		assert(preloadEntries[0].extension.pluginData && typeof preloadEntries[0].extension.pluginData === 'object', 'pluginData 应为对象')

		// 第二次 send 提及同一未变文件：不新增预读条目
		const userEntry2 = { id: 'p-u2', uid: 'user', role: 'user', name: node.username, content: `再看 ./${fileName}`, time: new Date().toISOString(), files: [] }
		const { done: done2 } = await sessionStream(node, {
			type: 'send', session: { ...saved, entries: [...saved.entries, userEntry2] }, machine: '0', workdir: root,
			ai_source: '', profile: '', content: `再看 ./${fileName}`, files: [], clientEntryId: 'p-u2',
		})
		assertEquals(done2.type, 'done', `expected done, got ${JSON.stringify(done2).slice(0, 300)}`)
		const saved2 = await readSession(root, session.id)
		assertEquals(
			saved2.entries.filter(entry => entry.role === 'tool' && entry.extension?.pluginData).length,
			preloadEntries.length,
			'同一未变文件重复提及不应新增预读条目'
		)

		// 重生成重新运行 BeforeReply 钩子
		const before = (await readObservations(root)).length
		const { done: done3 } = await sessionStream(node, { type: 'regen', session: saved2, machine: '0', workdir: root, ai_source: '', profile: '' })
		assertEquals(done3.type, 'done', `expected done, got ${JSON.stringify(done3).slice(0, 300)}`)
		assertEquals((await readObservations(root)).length, before + 1, '重生成应再次运行 BeforeReply 钩子')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
		await stopNode(node)
	}
})
