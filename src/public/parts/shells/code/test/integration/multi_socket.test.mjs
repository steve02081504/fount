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
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { waitUntil } from 'fount/scripts/test/core/wait.mjs'
import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { createCodeClient } from '../../cli/client.mjs'
import { Run } from '../../cli/main.mjs'
import { createTransport } from '../../cli/transport.mjs'

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
		const abortedEntry = abortedA.entries.find(entry => entry.name === 'aborted')
		assertEquals(abortedEntry.extension.usage.total.outputTokens, 2)
		const storedA = await (await codeFetch(node, 'GET', `/sessions/concA?machine=0&workdir=${encodeURIComponent(root)}`)).json()
		assertEquals(storedA.entries.find(entry => entry.id === abortedEntry.id).extension.usage, abortedEntry.extension.usage)
		assertEquals(storedA.usage.calls.length, 1)
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

/**
 * 场景六：CLI 式提交在会话忙时拒绝取代，并在版本过期时报告冲突；attach 回放只发给新连接。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioCliBusyAndVersion(node) {
	const { root } = await makeWorkspace(node, 'cli-guard')
	const sockets = []
	try {
		const session = makeSession('cliguard01', 'wsSlowChar')
		assertEquals((await codeFetch(node, 'POST', '/sessions', { machine: '0', workdir: root, session })).status, 200)
		session.version = 1
		const owner = openFramesWs(sessionWsUrl(node)); sockets.push(owner)
		const observer = openFramesWs(sessionWsUrl(node)); sockets.push(observer)
		await Promise.all([owner.ready, observer.ready])
		owner.send({ type: 'send', runId: 'guard-owner', session, machine: '0', workdir: root, content: 'slow-owner', expectedVersion: 1, replace: false })
		await owner.waitFor(frame => frame.type === 'run-start' && frame.runId === 'guard-owner')
		observer.send({ type: 'attach', sessionId: session.id })
		await observer.waitFor(frame => frame.type === 'run-start' && frame.runId === 'guard-owner')
		assertEquals(owner.frames.filter(frame => frame.type === 'run-start' && frame.runId === 'guard-owner').length, 1)
		observer.send({ type: 'send', runId: 'guard-busy', session, machine: '0', workdir: root, content: 'must-not-replace', expectedVersion: 1, replace: false })
		const busy = await observer.waitFor(frame => frame.type === 'error' && frame.runId === 'guard-busy')
		assertEquals(busy.code, 'busy')
		owner.send({ type: 'abort', sessionId: session.id, runId: 'guard-owner' })
		await owner.waitFor(frame => frame.type === 'aborted' && frame.runId === 'guard-owner')
		const stale = openFramesWs(sessionWsUrl(node)); sockets.push(stale); await stale.ready
		stale.send({ type: 'send', runId: 'guard-stale', session, machine: '0', workdir: root, content: 'stale', expectedVersion: 1, replace: false })
		const conflict = await stale.waitFor(frame => frame.type === 'error' && frame.runId === 'guard-stale')
		assertEquals(conflict.code, 'version-conflict')
	}
	finally {
		for (const socket of sockets) socket.close()
		await fs.rm(root, { recursive: true, force: true })
	}
}

/**
 * 两个同时到达的 CLI 提交即使在读同一份磁盘版本时也只能有一个成为运行。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioSimultaneousCliSend(node) {
	const { root } = await makeWorkspace(node, 'cli-simultaneous')
	const sockets = []
	try {
		const session = makeSession('clirace01', 'wsSlowChar')
		assertEquals((await codeFetch(node, 'POST', '/sessions', { machine: '0', workdir: root, session })).status, 200)
		session.version = 1
		const first = openFramesWs(sessionWsUrl(node)); sockets.push(first)
		const second = openFramesWs(sessionWsUrl(node)); sockets.push(second)
		await Promise.all([first.ready, second.ready])
		first.send({ type: 'send', runId: 'race-one', session, machine: '0', workdir: root, content: 'slow-one', expectedVersion: 1, replace: false })
		second.send({ type: 'send', runId: 'race-two', session, machine: '0', workdir: root, content: 'slow-two', expectedVersion: 1, replace: false })
		const [a, b] = await Promise.all([
			first.waitFor(frame => frame.runId === 'race-one' && ['run-start', 'error'].includes(frame.type)),
			second.waitFor(frame => frame.runId === 'race-two' && ['run-start', 'error'].includes(frame.type)),
		])
		assertEquals([a.type, b.type].sort(), ['error', 'run-start'])
		assertEquals((a.type === 'error' ? a : b).code, 'busy')
		const owner = a.type === 'run-start' ? first : second
		owner.send({ type: 'abort', sessionId: session.id, runId: a.type === 'run-start' ? 'race-one' : 'race-two' })
		await owner.waitFor(frame => frame.type === 'aborted')
	}
	finally {
		for (const socket of sockets) socket.close()
		await fs.rm(root, { recursive: true, force: true })
	}
}

/**
 * 另一个工作区的 CLI 观察者不能接入或中止同 ID 的运行。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioScopedCliAttachAbort(node) {
	const firstWorkspace = await makeWorkspace(node, 'cli-target-one')
	const secondWorkspace = await makeWorkspace(node, 'cli-target-two')
	const sockets = []
	try {
		const session = makeSession('clitarget01', 'wsSlowChar')
		assertEquals((await codeFetch(node, 'POST', '/sessions', { machine: '0', workdir: firstWorkspace.root, session })).status, 200)
		const owner = openFramesWs(sessionWsUrl(node)); sockets.push(owner)
		const other = openFramesWs(sessionWsUrl(node)); sockets.push(other)
		await Promise.all([owner.ready, other.ready])
		owner.send({ type: 'send', runId: 'target-owner', session: { ...session, version: 1 }, machine: '0', workdir: firstWorkspace.root, content: 'slow-owner', expectedVersion: 1, replace: false })
		await owner.waitFor(frame => frame.type === 'run-start' && frame.runId === 'target-owner')
		other.send({ type: 'attach', sessionId: session.id, machine: '0', workdir: secondWorkspace.root })
		assertEquals((await other.waitFor(frame => frame.type === 'error')).error, 'no active run')
		other.send({ type: 'abort', sessionId: session.id, runId: 'target-owner', machine: '0', workdir: secondWorkspace.root })
		owner.send({ type: 'attach', sessionId: session.id, runId: 'different-run', machine: '0', workdir: firstWorkspace.root })
		assertEquals((await owner.waitFor(frame => frame.type === 'error')).error, 'no active run')
		owner.send({ type: 'abort', sessionId: session.id, runId: 'target-owner', machine: '0', workdir: firstWorkspace.root })
		await owner.waitFor(frame => frame.type === 'aborted' && frame.runId === 'target-owner')
	}
	finally {
		for (const socket of sockets) socket.close()
		await fs.rm(firstWorkspace.root, { recursive: true, force: true })
		await fs.rm(secondWorkspace.root, { recursive: true, force: true })
	}
}

/**
 * 场景七：CLI 传输层与客户端能通过 HTTP/WS 完成一轮并落盘。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioCliClient(node) {
	const { root, workspaceId } = await makeWorkspace(node, 'cli-client')
	try {
		const transport = createTransport({ baseUrl: node.baseUrl, apiKey: node.apiKey })
		const client = createCodeClient({ transport, workspaceId, username: 'code-multi-user', char: 'wsEchoChar' })
		await client.selectWorkspace(workspaceId)
		await client.openSession('cliclient01')
		const result = await client.run({ input: 'hello from CLI' })
		assertEquals(result.status, 'done')
		assert(result.entries.some(entry => entry.role === 'char'))
		const stored = await transport.get(`/api/parts/shells:code/sessions/${client.state.sessionId}?machine=0&workdir=${encodeURIComponent(root)}`)
		assertEquals(stored.entries.filter(entry => entry.role === 'user').length, 1)
		client.dispose()
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
}

/**
 * 场景八：print 入口真跑一轮，确认它落盘、只把本轮文本写 stdout、把身份信息写 stderr。
 * @param {object} node - 共享测试节点。
 * @returns {Promise<void>}
 */
async function scenarioCliPrint(node) {
	const { root, workspaceId } = await makeWorkspace(node, 'cli-print')
	const out = []
	const err = []
	const cleanups = []
	/**
	 * 造一个把写入内容收集起来的可写流。
	 * @param {string[]} chunks - 收集目标。
	 * @returns {Writable} 捕获流。
	 */
	const capture = chunks => new Writable({
		/**
		 * 记录一次写入。
		 * @param {Buffer} chunk - 写入的字节。
		 * @param {string} _encoding - 编码名。
		 * @param {Function} callback - 完成回调。
		 * @returns {void} 无返回值。
		 */
		write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() },
	})
	try {
		const code = await Run({
			args: ['--print', '--session', 'print01', '--char', 'wsEchoChar', '--prompt', 'hello print'],
			data: { baseUrl: node.baseUrl, apiKey: node.apiKey, username: 'code-multi-user', workspaceId },
			stdin: { isTTY: false }, stdout: capture(out), stderr: capture(err), isTTY: false,
			/**
			 * 登记直接调用 Run 所需的清理回调。
			 * @param {Function} callback - 清理回调。
			 * @returns {void} 无返回值。
			 */
			onCleanup: callback => { cleanups.push(callback) },
		})
		assertEquals(code, 0)
		const outputEntries = out.join('').trim().split('\n').map(line => JSON.parse(line))
		assert(outputEntries.some(entry => entry.role === 'char' && entry.name === 'wsEchoChar'), 'print NDJSON writes the committed assistant entry')
		assert(outputEntries.some(entry => entry.role === 'user' && entry.content === 'hello print'), 'print NDJSON includes the submitted user entry')
		const reply = outputEntries.find(entry => entry.role === 'char' && entry.name === 'wsEchoChar')
		assertEquals(reply.extension.usage.total.outputTokens, 2, 'reply entry carries its usage in extension')
		const stored = await (await codeFetch(node, 'GET', `/sessions/print01?machine=0&workdir=${encodeURIComponent(root)}`)).json()
		assertEquals(stored.usage.total.inputTokens, 3, 'session aggregate persists the recorded run usage')
		assertEquals(stored.usage.total.outputTokens, 2, 'session aggregate preserves output usage')
		assert(err.join('').includes('sessionId=print01'), '会话身份写 stderr')
		assert(err.join('').includes('runId='), '运行身份写 stderr')
		out.length = 0
		const failedCode = await Run({
			args: ['--print', '--session', 'failed01', '--char', 'wsEchoChar', '--prompt', 'metered failure'],
			data: { baseUrl: node.baseUrl, apiKey: node.apiKey, username: 'code-multi-user', workspaceId },
			stdin: { isTTY: false }, stdout: capture(out), stderr: capture(err), isTTY: false,
			/**
			 * 登记失败运行的清理回调。
			 * @param {Function} callback - 清理回调。
			 * @returns {void} 无返回值。
			 */
			onCleanup: callback => { cleanups.push(callback) },
		})
		assertEquals(failedCode, 1)
		const failedEntries = out.join('').trim().split('\n').map(line => JSON.parse(line))
		const failure = failedEntries.find(entry => entry.role === 'system' && entry.name === 'error')
		assertEquals(failure.extension.usage.total.outputTokens, 2)
		const failedStored = await (await codeFetch(node, 'GET', `/sessions/failed01?machine=0&workdir=${encodeURIComponent(root)}`)).json()
		assertEquals(failedStored.entries.find(entry => entry.id === failure.id).extension.usage, failure.extension.usage)
		assertEquals(failedStored.usage.calls.length, 1)
	}
	finally {
		for (const cleanup of cleanups.reverse()) await cleanup()
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
		await t.step('CLI send refuses busy and stale session versions; attach replay stays local', () => scenarioCliBusyAndVersion(node))
		await t.step('simultaneous CLI sends admit only one run', () => scenarioSimultaneousCliSend(node))
		await t.step('CLI attach and abort are scoped to the selected workspace and run', () => scenarioScopedCliAttachAbort(node))
		await t.step('CLI print entry point emits one persisted turn to stdout', () => scenarioCliPrint(node))
		await t.step('CLI transport and client send a persisted round over HTTP and WS cookies', () => scenarioCliClient(node))
	}
	finally {
		await stopNode(node)
	}
})
