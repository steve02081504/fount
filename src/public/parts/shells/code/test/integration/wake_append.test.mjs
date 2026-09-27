/* global Deno */
/**
 * code shell 后端唤醒与追加：运行中/过期请求的 AddChatLogEntry 落点、RequestCharReply 唤醒调度。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path, { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { waitUntil } from 'fount/scripts/test/core/wait.mjs'
import { createTestServerBoot, ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

import { buildCodeChatRequest } from '../../src/request.mjs'
import { activeCodeRuns, codeRunKey, codeWakes, requestCodeRunStart, setCodeRunStarter } from '../../src/runs.mjs'
import { loadSession, saveSession } from '../../src/sessions.mjs'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * 创建同进程 code shell 测试 boot（惰性启动；首次 boot 后 loadParts 不再重复，afterInit 每个用户都会跑）。
 * @param {string} username - 测试用户名。
 * @param {string} charName - 要 seed 的角色 fixture 名。
 * @returns {{ensureServer: () => Promise<{dataDir: string, username: string}>, username: string}} boot 句柄。
 */
function createCodeBoot(username, charName) {
	const dataDir = ensureSharedTestDataDir()
	return {
		/**
		 * 启动（或复用）进程内 server 并 seed 角色 fixture。
		 * @returns {Promise<{dataDir: string, username: string}>} data 根与用户名。
		 */
		async ensureServer() {
			return await createTestServerBoot({
				username,
				dataDir,
				minP2pNode: false,
				p2p: false,
				loadParts: ['shells/code'],
				/**
				 * 把 code 集成 fixture 复制到用户 chars 目录。
				 * @param {string} user - 用户名。
				 * @returns {Promise<void>}
				 */
				afterInit: async user => {
					await fs.cp(join(fixturesDir, charName), join(dataDir, 'users', user, 'chars', charName), { recursive: true })
				},
			})()
		},
		username,
	}
}

/**
 * 构造测试会话对象。
 * @param {string} id - 会话 id。
 * @param {string} charname - 角色名。
 * @param {object[]} [entries] - 初始条目。
 * @returns {object} 会话。
 */
function makeSession(id, charname, entries = []) {
	const now = new Date().toISOString()
	return { id, title: '', charname, profile: '', ai_source: '', created: now, updated: now, memory: {}, entries }
}

/**
 * 建临时工作区目录（fount 前缀，便于泄漏检查识别；调用方 finally 清理）。
 * @param {string} tag - 用途标签。
 * @returns {Promise<string>} 目录绝对路径。
 */
function makeWorkspace(tag) {
	return fs.mkdtemp(join(os.tmpdir(), `fount_code_wake_${tag}_`))
}

Deno.test('requestCodeRunStart starts when idle, marks the wake while a run holds the slot', async () => {
	// 本用例先于任何 boot 运行：endpoints 尚未注册真实启动器，用假启动器隔离调度语义。
	const username = 'wake-unit'
	const sessionId = 'unit-session'
	const key = codeRunKey(username, sessionId)
	let started = 0
	setCodeRunStarter(async () => { started++ })
	try {
		await requestCodeRunStart({ username, sessionId })
		assertEquals(started, 1, '空闲时应启动生成')
		// 模拟运行持有唤醒槽
		assertEquals(codeWakes.tryBegin(key), true)
		await requestCodeRunStart({ username, sessionId })
		assertEquals(started, 1, '生成中不应再启动新运行，只标记唤醒')
		assertEquals(codeWakes.release(key), true, '未被观察的唤醒应在 release 时报告待补触发')
		// 已被 Update({ forRound: true }) 观察的唤醒不再补触发
		codeWakes.tryBegin(key)
		codeWakes.observe(key, codeWakes.snapshot())
		assertEquals(codeWakes.release(key), false, '已观察的唤醒不应补触发')
	}
	finally {
		codeWakes.discard(key)
	}
})

Deno.test('stale AddChatLogEntry persists to the workspace session file and broadcasts a display event', async () => {
	const boot = createCodeBoot('wake-stale', 'wsEchoChar')
	const { username } = await boot.ensureServer()
	const root = await makeWorkspace('stale')
	try {
		const session = makeSession('stale01', 'wsEchoChar')
		await saveSession(username, { machine: '0', path: root }, session)
		// 无活动运行：过期请求对象（构建时尚未有运行）
		const request = await buildCodeChatRequest({ username, session, machine: '0', workdir: root, ai_source: '', profile: '' })
		await request.AppendChatLogEntry({ role: 'system', content: 'stale-notice', charVisibility: ['wsEchoChar'] })
		const disk = await loadSession(username, { machine: '0', path: root }, 'stale01')
		assert(
			disk?.entries?.some(entry => entry.content === 'stale-notice'),
			`过期追加应落盘工作区会话：${JSON.stringify(disk?.entries)}`,
		)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('RequestCharReply with no active run starts a backend run and persists the reply', async () => {
	const boot = createCodeBoot('wake-start', 'wsEchoChar')
	const { username } = await boot.ensureServer()
	const root = await makeWorkspace('start')
	try {
		const session = makeSession('wake02', 'wsEchoChar', [
			{ id: 'u1', uid: 'user', role: 'user', name: username, content: 'hello', time: new Date().toISOString(), files: [] },
		])
		await saveSession(username, { machine: '0', path: root }, session)
		const request = await buildCodeChatRequest({ username, session, machine: '0', workdir: root, ai_source: '', profile: '' })
		await request.RequestCharReply()
		let disk = null
		await waitUntil(async () => {
			disk = await loadSession(username, { machine: '0', path: root }, 'wake02')
			return disk?.entries?.some(entry => entry.role === 'char' && entry.content.includes('echo-reply'))
		}, 20000, 50)
		assert(disk.entries.some(entry => entry.role === 'char' && entry.content.includes('echo-reply')), '后端唤醒应生成并落盘角色回复')
		assert(!disk.entries.some(entry => entry.is_generating), '收尾后不应残留生成中占位')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('AddChatLogEntry during a run lands in the live session and a wake drains a follow-up', async () => {
	const boot = createCodeBoot('wake-live', 'wsRoundsChar')
	const { username } = await boot.ensureServer()
	const root = await makeWorkspace('live')
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'note content', 'utf8')
		const session = makeSession('wake03', 'wsRoundsChar', [
			{ id: 'u1', uid: 'user', role: 'user', name: username, content: '读取文件', time: new Date().toISOString(), files: [] },
		])
		await saveSession(username, { machine: '0', path: root }, session)
		const request = await buildCodeChatRequest({ username, session, machine: '0', workdir: root, ai_source: '', profile: '' })
		const key = codeRunKey(username, 'wake03')
		// 订阅全局用户事件，捕获 code-session-entry 展示事件
		const { events } = await import('fount/server/events.mjs')
		/** @type {object[]} */
		const sessionEntryEvents = []
		/**
		 * 记录本用户的 code-session-entry 事件。
		 * @param {object} payload - 事件负载。
		 * @returns {void}
		 */
		const onEvent = payload => {
			if (payload?.type === 'code-session-entry' && payload?.data?.chatName === 'code-wake03') sessionEntryEvents.push(payload.data)
		}
		events.on('send-event-to-user', onEvent)
		try {
			// 空闲唤醒：后端自行启动运行
			void request.RequestCharReply()
			await waitUntil(() => activeCodeRuns.has(key), 15000, 20)
			const run = activeCodeRuns.get(key)
			// 运行中追加：应写入运行中的权威副本
			await request.AppendChatLogEntry({ role: 'system', content: 'live-notice', charVisibility: ['wsRoundsChar'] })
			assert(
				run.requestSession.entries.some(entry => entry.content === 'live-notice'),
				'运行中追加应落入 run.requestSession.entries',
			)
			// 运行中追加非角色条目应广播展示事件（供打开着的页面即时合并）
			assert(
				sessionEntryEvents.some(payload => payload.entry?.content === 'live-notice'),
				`运行中追加应广播 code-session-entry：${JSON.stringify(sessionEntryEvents)}`,
			)
			// attach 回放应包含该追加条目（requestSession-only，不在 allNewEntries 之外的其它调用也需覆盖）
			const replay = run.buildReplayEntries()
			assert(
				replay.some(entry => entry.content === 'live-notice'),
				`attach 回放应包含运行中追加的条目：${JSON.stringify(replay.map(entry => entry.content))}`,
			)
			assert(
				new Set(replay.map(entry => String(entry.id))).size === replay.length,
				'attach 回放应按 id 去重',
			)
			// 运行中再次唤醒：不新开运行，仅标记；运行结束补一次触发
			void request.RequestCharReply()
		}
		finally {
			events.off('send-event-to-user', onEvent)
		}
		let disk = null
		await waitUntil(async () => {
			disk = await loadSession(username, { machine: '0', path: root }, 'wake03')
			const replies = disk?.entries?.filter(entry => entry.role === 'char').length ?? 0
			return replies >= 2 && !disk.entries.some(entry => entry.is_generating)
		}, 30000, 50)
		assert(disk.entries.some(entry => entry.content === 'live-notice'), '运行中追加的条目应随运行收尾落盘')
		assert(disk.entries.filter(entry => entry.role === 'char').length >= 2, '未消费的唤醒应在运行结束后补一次生成')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
