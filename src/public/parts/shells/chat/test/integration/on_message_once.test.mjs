/**
 * OnMessage 去重 — 单条消息的 fanout 触发管线与 AfterAddChatLogEntry 复用预计算结果，每角色仅调用一次 OnMessage。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'jsr:@std/assert'

import { onMessageProbe } from '../fixtures/probes/onMessageProbe.mjs'
import { createCharBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const WORLD = 'write_path_hooks'
const CHAR = 'on_message_yes'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedWorld(dataDir, username) {
	const to = join(dataDir, 'users', username, 'worlds', WORLD)
	await mkdir(dirname(to), { recursive: true })
	await cp(join(fixturesRoot, 'worlds', WORLD), to, { recursive: true })
}

/**
 * 等 probe 事件流静默（addchar 的初始 greeting 异步落地，可能晚于设置到达）。
 * @param {object} probe onMessageProbe 单例
 * @param {number} [quietMs] 静默窗口
 * @param {number} [maxMs] 总等待上限
 * @returns {Promise<void>} 静默或超时
 */
async function waitProbeQuiet(probe, quietMs = 1200, maxMs = 15000) {
	const start = Date.now()
	let lastCount = -1
	let lastChangeAt = Date.now()
	while (Date.now() - start < maxMs) {
		const count = probe.events.length
		if (count !== lastCount) {
			lastCount = count
			lastChangeAt = Date.now()
		}
		if (Date.now() - lastChangeAt >= quietMs) return
		await new Promise(resolve => setTimeout(resolve, 100))
	}
}

Deno.test('each char OnMessage runs once per fanout message', async () => {
	const username = `om1-${crypto.randomUUID().slice(0, 8)}`
	onMessageProbe.reset()
	const { ensureServer, dataDir } = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			await seedWorld(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar, bindWorld } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'on-message-once' })
	const channelId = await getDefaultChannelId(username, groupId)
	await bindWorld(groupId, channelId, WORLD, username)
	await addchar(groupId, CHAR, username)
	// 拒绝回复，隔离 fanout/After 的 OnMessage 计数，避免后续生成阶段再次评估
	onMessageProbe.returnValue = false
	await waitProbeQuiet(onMessageProbe)
	onMessageProbe.reset()

	await postChannelMessage(username, groupId, channelId, { text: 'dedup probe message' })
	await new Promise(resolve => setTimeout(resolve, 500))

	assertEquals(onMessageProbe.events.length, 1, 'OnMessage invoked exactly once for the message')
})
