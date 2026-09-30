/* global Deno */
/**
 * code shell 会话运行多观察连接 / 指定运行中止 / 终态事件 / 仅附件发送集成测试。
 *
 * 整个文件共享一个测试节点：节点启动（复制 fixtures + 拉起 fount 子进程）比用例本身昂贵，
 * 而每个场景都使用独立的 session id / workspace 目录，复用节点是安全的。场景以 t.step 串行执行，
 * 默认的 Deno 行为是某一步失败后仍继续后续步骤，因此单个场景失败不会掩盖其余场景。
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { waitUntil } from 'fount/scripts/test/core/wait.mjs'
import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { codeFetch, sessionStream } from './helpers/code_http.mjs'

const fixturesDir = path.join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const slowFixtureDir = path.join(fixturesDir, 'wsSlowChar')
const echoFixtureDir = path.join(fixturesDir, 'wsEchoChar')

/**
 * 启动仅加载 code shell、同时注入慢速与回声两个测试角色的测试节点。
 * @returns {Promise<object>} 测试节点。
 */
async function launchSharedNode() {
	return await launchNode({
		username: 'code-multi-user',
		apiKey: `fount-code-multi-${Date.now().toString(36)}`,
		loadParts: ['shells/code'],
		p2p: false,
		minP2pNode: true,
		fixtureCopies: [
			{ from: slowFixtureDir, to: 'chars/wsSlowChar' },
			{ from: echoFixtureDir, to: 'chars/wsEchoChar' },
		],
	})
}

/**
 * 会话 WS 完整地址。
 * @param {object} node - 测试节点。
 * @returns {string} ws URL。
 */
function sessionWsUrl(node) {
	return `${node.baseUrl.replace(/^http/, 'ws')}/ws/parts/shells:code/session?fount-apikey=${encodeURIComponent(node.apiKey)}`
}

/**
 * 用户通知 WS 完整地址。
 * @param {object} node - 测试节点。
 * @returns {string} ws URL。
 */
function notifyWsUrl(node) {
	return `${node.baseUrl.replace(/^http/, 'ws')}/ws/notify?fount-apikey=${encodeURIComponent(node.apiKey)}`
}

/**
 * 建立一条 WebSocket 并缓存收到的全部 JSON 帧，支持按谓词等待指定帧。
 * @param {string} url - 完整 ws URL。
 * @returns {{frames: object[], ready: Promise<void>, send: (payload: object) => void, waitFor: (predicate: (frame: object) => boolean, timeoutMs?: number) => Promise<object>, close: () => void}} 句柄。
 */
function openFramesWs(url) {
	const ws = new WebSocket(url)
	const frames = []
	const waiters = []
	/** 连接就绪（open）或失败（error）。 @type {Promise<void>} */
	const ready = new Promise((resolve, reject) => {
		/**
		 * 连接建立。
		 * @returns {void}
		 */
		ws.onopen = () => resolve()
		/**
		 * 连接失败。
		 * @returns {void}
		 */
		ws.onerror = () => reject(new Error('ws error'))
	})
	/**
	 * 缓存一帧并唤醒匹配的等待者。
	 * @param {MessageEvent} event - 入站消息事件。
	 * @returns {void}
	 */
	ws.onmessage = event => {
		const frame = JSON.parse(String(event.data))
		frames.push(frame)
		for (const waiter of [...waiters]) {
			if (!waiter.predicate(frame)) continue
			waiters.splice(waiters.indexOf(waiter), 1)
			clearTimeout(waiter.timer)
			waiter.resolve(frame)
		}
	}
	/**
	 * 等待满足谓词的一帧（已收到则立即返回）。
	 * @param {(frame: object) => boolean} predicate - 帧判定。
	 * @param {number} [timeoutMs] - 超时（毫秒）。
	 * @returns {Promise<object>} 匹配帧。
	 */
	const waitFor = (predicate, timeoutMs = 30_000) => {
		const found = frames.find(predicate)
		if (found) return Promise.resolve(found)
		return new Promise((resolve, reject) => {
			const waiter = { predicate, resolve, timer: 0 }
			waiter.timer = setTimeout(() => {
				const index = waiters.indexOf(waiter)
				if (index >= 0) waiters.splice(index, 1)
				reject(new Error(`frame timeout; got ${JSON.stringify(frames.map(frame => frame.type))}`))
			}, timeoutMs)
			waiters.push(waiter)
		})
	}
	/**
	 * 发送一帧 JSON。
	 * @param {object} payload - 帧负载。
	 * @returns {void}
	 */
	const send = payload => ws.send(JSON.stringify(payload))
	/**
	 * 关闭连接。
	 * @returns {void}
	 */
	const close = () => ws.close()
	return { frames, ready, send, waitFor, close }
}

/**
 * 创建并保存一个临时工作区。
 * @param {object} node - 测试节点。
 * @param {string} tag - 用途标签（同时作为临时目录前缀片段）。
 * @returns {Promise<{root: string, workspaceId: string}>} 工作区路径与 id。
 */
async function makeWorkspace(node, tag) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `fount_code_multi_${tag}_`))
	try {
		assertEquals((await codeFetch(node, 'POST', '/workspaces', { name: tag, machine: '0', path: root })).status, 200)
		const list = await (await codeFetch(node, 'GET', '/workspaces')).json()
		const workspace = list.list.find(item => item.path === root)
		assert(workspace, '工作区已保存')
		return { root, workspaceId: workspace.id }
	}
	catch (error) {
		await fs.rm(root, { recursive: true, force: true })
		throw error
	}
}

/**
 * 构造测试会话对象。
 * @param {string} id - 会话 id。
 * @param {string} charname - 角色名。
 * @returns {object} 会话。
 */
function makeSession(id, charname) {
	const now = new Date().toISOString()
	return { id, title: '', charname, profile: '', ai_source: '', created: now, updated: now, memory: {}, entries: [] }
}

/**
 * 场景一：两个会话并发生成；按匹配 runId 中止只停对应运行，迟到的陈旧 runId 被忽略。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioConcurrentAbort(node) {
	const { root } = await makeWorkspace(node, 'conc')
	const closeables = []
	try {
		const sessionA = makeSession('concA', 'wsSlowChar')
		const sessionB = makeSession('concB', 'wsSlowChar')
		const wsA = openFramesWs(sessionWsUrl(node)); closeables.push(() => wsA.close())
		const wsB = openFramesWs(sessionWsUrl(node)); closeables.push(() => wsB.close())
		await Promise.all([wsA.ready, wsB.ready])
		wsA.send({ type: 'send', runId: 'run-A', session: sessionA, machine: '0', workdir: root, ai_source: '', profile: '', content: 'slow-A', files: [] })
		wsB.send({ type: 'send', runId: 'run-B', session: sessionB, machine: '0', workdir: root, ai_source: '', profile: '', content: 'slow-B', files: [] })
		await Promise.all([
			wsA.waitFor(frame => frame.type === 'run-start'),
			wsB.waitFor(frame => frame.type === 'run-start'),
		])
		// 迟到的旧 runId 中止应被忽略：B 继续运行
		wsB.send({ type: 'abort', sessionId: sessionB.id, runId: 'stale-run' })
		// 携带匹配 runId 的中止只停 A
		wsA.send({ type: 'abort', sessionId: sessionA.id, runId: 'run-A' })
		const abortedA = await wsA.waitFor(frame => frame.type === 'aborted')
		assertEquals(abortedA.runId, 'run-A')
		assertEquals(abortedA.sessionId, sessionA.id)
		// B 在 A 中止后继续流式并正常完成
		const doneB = await wsB.waitFor(frame => frame.type === 'done')
		assertEquals(doneB.runId, 'run-B')
		assert(!wsB.frames.some(frame => frame.type === 'aborted'), `B 不应被中止：${JSON.stringify(wsB.frames.map(frame => frame.type))}`)
		assert(!wsA.frames.some(frame => frame.type === 'done'), 'A 不应完成')
	}
	finally {
		for (const close of closeables) close()
		await fs.rm(root, { recursive: true, force: true })
	}
}

/**
 * 场景二：多连接观察同一运行；关闭其中一条，运行继续且另一条仍收到流式帧。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioMultiConnection(node) {
	const { root } = await makeWorkspace(node, 'multi')
	const closeables = []
	try {
		const session = makeSession('multi01', 'wsSlowChar')
		const wsA = openFramesWs(sessionWsUrl(node)); closeables.push(() => wsA.close())
		await wsA.ready
		wsA.send({ type: 'send', runId: 'run-multi', session, machine: '0', workdir: root, ai_source: '', profile: '', content: 'slow-multi', files: [] })
		await wsA.waitFor(frame => frame.type === 'run-start')
		// 第二个连接接入同一运行（不替换 A）
		const wsB = openFramesWs(sessionWsUrl(node)); closeables.push(() => wsB.close())
		await wsB.ready
		wsB.send({ type: 'attach', sessionId: session.id })
		const startB = await wsB.waitFor(frame => frame.type === 'run-start')
		assertEquals(startB.runId, 'run-multi')
		// 两个连接都应收到后续流式帧
		await Promise.all([
			wsA.waitFor(frame => frame.type === 'preview'),
			wsB.waitFor(frame => frame.type === 'preview'),
		])
		// 关闭 B：运行继续，A 仍收到后续帧
		wsB.close()
		const previewsBefore = wsA.frames.filter(frame => frame.type === 'preview').length
		await waitUntil(() => wsA.frames.filter(frame => frame.type === 'preview').length > previewsBefore, 5000)
		const done = await wsA.waitFor(frame => frame.type === 'done')
		assertEquals(done.runId, 'run-multi')
	}
	finally {
		for (const close of closeables) close()
		await fs.rm(root, { recursive: true, force: true })
	}
}

/**
 * 场景三：完成的运行落盘后才派发 code-run-settled 终态事件。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioRunSettled(node) {
	const { root, workspaceId } = await makeWorkspace(node, 'settle')
	const closeables = []
	try {
		const notify = openFramesWs(notifyWsUrl(node)); closeables.push(() => notify.close())
		await notify.ready
		const session = makeSession('settle01', 'wsEchoChar')
		const { done } = await sessionStream(node, {
			type: 'send', runId: 'run-settle-1', session, machine: '0', workdir: root,
			ai_source: '', profile: '', content: 'hello', files: [],
		})
		assertEquals(done.type, 'done')
		const event = await notify.waitFor(frame => frame.type === 'code-run-settled' && frame.data?.runId === 'run-settle-1')
		assertEquals(event.data.status, 'done')
		assertEquals(event.data.sessionId, session.id)
		assertEquals(event.data.chatName, 'code-' + session.id)
		assertEquals(event.data.workspaceId, workspaceId)
		// 事件到达时权威会话已落盘
		const saved = JSON.parse(await fs.readFile(path.join(root, '.fount', 'code', 'sessions', session.id + '.json'), 'utf8'))
		assert(saved.entries.some(entry => entry.role === 'char' && entry.content.includes('echo-reply')), '落盘应含角色回复')
		assert(!saved.entries.some(entry => entry.is_generating), '落盘不应残留生成中占位')
	}
	finally {
		for (const close of closeables) close()
		await fs.rm(root, { recursive: true, force: true })
	}
}

/**
 * 场景四：仅附件发送成功并持久化用户条目的附件。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioFilesOnly(node) {
	const { root } = await makeWorkspace(node, 'files')
	try {
		const session = makeSession('files01', 'wsEchoChar')
		const { done } = await sessionStream(node, {
			type: 'send', runId: 'run-files-1', session, machine: '0', workdir: root,
			ai_source: '', profile: '', content: '',
			files: [{ name: 'a.txt', mime_type: 'text/plain', buffer: Buffer.from('hello').toString('base64'), description: '测试附件' }],
		})
		assertEquals(done.type, 'done')
		const saved = JSON.parse(await fs.readFile(path.join(root, '.fount', 'code', 'sessions', session.id + '.json'), 'utf8'))
		const userEntry = saved.entries.find(entry => entry.role === 'user')
		assert(userEntry, '应持久化用户条目')
		assertEquals(userEntry.content, '')
		assertEquals(userEntry.files.length, 1)
		assertEquals(userEntry.files[0].name, 'a.txt')
		assertEquals(userEntry.files[0].description, '测试附件')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
}

/**
 * 场景五：被同一会话的新请求取代的旧运行不派发 code-run-settled。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioSuperseded(node) {
	const { root } = await makeWorkspace(node, 'supersede')
	const closeables = []
	try {
		const notify = openFramesWs(notifyWsUrl(node)); closeables.push(() => notify.close())
		await notify.ready
		const session = makeSession('super01', 'wsSlowChar')
		const ws = openFramesWs(sessionWsUrl(node)); closeables.push(() => ws.close())
		await ws.ready
		// 旧运行（慢速）先开始
		ws.send({ type: 'send', runId: 'run-old', session, machine: '0', workdir: root, ai_source: '', profile: '', content: 'slow-old', files: [] })
		await ws.waitFor(frame => frame.type === 'run-start' && frame.runId === 'run-old')
		// 同一会话的新请求取代旧运行（新内容不含 slow，快速完成）
		ws.send({ type: 'send', runId: 'run-new', session, machine: '0', workdir: root, ai_source: '', profile: '', content: 'fast-new', files: [] })
		await ws.waitFor(frame => frame.type === 'run-start' && frame.runId === 'run-new')
		const done = await ws.waitFor(frame => frame.type === 'done' && frame.runId === 'run-new')
		assertEquals(done.type, 'done')
		const event = await notify.waitFor(frame => frame.type === 'code-run-settled' && frame.data?.sessionId === session.id)
		assertEquals(event.data.runId, 'run-new')
		assertEquals(event.data.status, 'done')
		// 给被取代的旧运行留出发帧窗口，再断言它从未派发终态事件
		await new Promise(resolve => setTimeout(resolve, 300))
		assert(
			!notify.frames.some(frame => frame.type === 'code-run-settled' && frame.data?.runId === 'run-old'),
			`被取代运行不应派发 code-run-settled：${JSON.stringify(notify.frames.filter(frame => frame.type === 'code-run-settled').map(frame => frame.data))}`,
		)
	}
	finally {
		for (const close of closeables) close()
		await fs.rm(root, { recursive: true, force: true })
	}
}

Deno.test({
	name: 'code session multi-socket runtime (concurrent abort / multi-attach / settled / files-only / supersede)',
	timeout: 120_000,
}, async t => {
	// 整个文件共享一个节点：启动一次（含 fixtures 复制）即可覆盖全部场景。
	const node = await launchSharedNode()
	try {
		await t.step('two sessions generate concurrently; abort by runId stops that run and a stale runId is ignored', () => scenarioConcurrentAbort(node))
		await t.step('multiple connections observe one run; closing one keeps the run and the other streaming', () => scenarioMultiConnection(node))
		await t.step('code-run-settled is emitted after the completed run is persisted', () => scenarioRunSettled(node))
		await t.step('files-only send succeeds and persists the user entry attachments', () => scenarioFilesOnly(node))
		await t.step('a superseded run does not emit code-run-settled', () => scenarioSuperseded(node))
	}
	finally {
		await stopNode(node)
	}
})
