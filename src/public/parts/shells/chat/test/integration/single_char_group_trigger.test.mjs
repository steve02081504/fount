/**
 * 单角色群 fallback 触发意愿：无 OnMessage 的角色在「单角色 + 多真人」群里不得无条件自动回复
 * （需要 @ 或显式 autoReplyFrequency）；「单角色 + 单真人」私聊保持自动回复。
 */
/* global Deno */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { allowNoise } from 'fount/scripts/test/core/allowNoise.mjs'

import { seedCharFixture, waitUntil } from '../harness.mjs'
import { createChatFederationSim } from '../simulation/federation.mjs'

const CHAR = 'plain_reply_b'
const REPLY_MARKER = 'plain_reply_b reply'

/**
 * headless sim 未注册 user，而 buildCharReplyPlaceholder 经 getPartDetails 依赖 user.locales；
 * 按 createTestServerBoot 的注册形状补齐运行中 server 的用户表。
 * @param {string} dataRoot sim 数据根
 * @param {string} username 用户名
 * @returns {Promise<void>}
 */
async function registerSimUser(dataRoot, username) {
	const { config, save_config } = await import('fount/server/server.mjs')
	if (!config.data.users[username]) {
		config.data.users[username] = {
			username,
			auth: { userId: 'test', password: 'test', loginAttempts: 0, lockedUntil: null, refreshTokens: [] },
			jobs: {},
			locales: ['zh-CN'],
			defaultParts: {},
			timers: {},
		}
		save_config()
	}
	await mkdir(join(dataRoot, 'users', username, 'settings'), { recursive: true })
	await mkdir(join(dataRoot, 'users', username, 'entities'), { recursive: true })
}

/**
 * 建一个绑定 plain_reply_b 的群，返回 sim 句柄与常用工具。
 * @returns {Promise<object>} sim 上下文
 */
async function setupSingleCharGroup() {
	const sim = await createChatFederationSim()
	const { modules, groupId, nodeName, joinGroup, federate, postMessage, stateOf } = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')

	await registerSimUser(sim.dataRoot, NODE_A)
	await registerSimUser(sim.dataRoot, NODE_B)
	await seedCharFixture(sim.dataRoot, NODE_A, CHAR)

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	await modules.lifecycle.createGroup(NODE_A, {
		groupId,
		name: 'Single char trigger',
		ownerPubKeyHash: ownerSigner.sender,
		secretKey: ownerSigner.secretKey,
		defaultChannelId: 'default',
		enableGroupFederation: false,
	})
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	await addchar(groupId, CHAR, NODE_A)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

	const channelId = (await stateOf(NODE_A, groupId)).groupSettings.defaultChannelId
	return { sim, modules, groupId, NODE_A, NODE_B, channelId, ownerSigner, joinGroup, federate, postMessage, stateOf }
}

/**
 * 第二真人以有效邀请码入群，并拿到频道密钥（可本地发消息）。
 * @param {object} ctx setupSingleCharGroup 返回值
 * @returns {Promise<void>}
 */
async function joinSecondHuman(ctx) {
	const { modules, groupId, NODE_A, NODE_B, ownerSigner, joinGroup, federate } = ctx
	const { mintGroupInviteTicket } = await import('../../src/chat/lib/inviteTickets.mjs')
	const { code } = await mintGroupInviteTicket(NODE_A, groupId)
	await joinGroup(NODE_B, NODE_A, groupId, code)
	await federate(NODE_B, [NODE_A], groupId)
	await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await federate(NODE_A, [NODE_B], groupId)
	await modules.schedule.rotateAllChannelKeys(NODE_A, groupId)
	await federate(NODE_A, [NODE_B], groupId)
}

/**
 * 群内 agent 成员的实体 hash（mention 目标）。
 * @param {object} modules sim 模块
 * @param {string} node 节点
 * @param {string} groupId 群 ID
 * @returns {Promise<string | undefined>} agent entityHash
 */
async function agentEntityHash(modules, node, groupId) {
	const { state } = await modules.materialize.getState(node, groupId)
	return Object.values(state.members).find(member => member?.memberKind === 'agent')?.entityHash
}

/**
 * 消息行正文（message 或 message_edit finalize 均覆盖）。
 * @param {object} row 频道消息行
 * @returns {string} 展示正文
 */
function rowText(row) {
	const c = row.content || {}
	return String(c.newContent?.content ?? c.content ?? row.content ?? '')
}

/**
 * 群内 plain_reply_b 回复的条数。
 * @param {object} modules sim 模块
 * @param {string} node 节点
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<number>} 回复条数
 */
async function replyCount(modules, node, groupId, channelId) {
	const rows = await modules.queries.listChannelMessages(node, groupId, channelId, { decrypt: true })
	return rows.filter(row => rowText(row).includes(REPLY_MARKER)).length
}

Deno.test('single-char + single-human chat: fallback replies without mention', async () => {
	const { modules, groupId, NODE_A, channelId, postMessage } = await setupSingleCharGroup()

	await postMessage(NODE_A, groupId, channelId, 'private ping', [])
	await waitUntil(async () => await replyCount(modules, NODE_A, groupId, channelId) >= 1, 15000, 100)
})

Deno.test('single-char + multi-human group: fallback needs mention or autoReplyFrequency', async () => {
	// sim 共享单 P2P node，B 节点视异地 char 为本机而尝试触发并失败（真实多节点由 skip 分支避免）；
	// 该 `Error:` 属测试环境人工制品，用噪声豁免窗口包住，避免 integration suite 判 noisy。
	// 标记走 allowNoise（stderr 直通）：console.log 的 stdout 会被 deno test 捕获并在满负载下偶发整行丢失。
	await allowNoise('char part not found', async () => {
		const ctx = await setupSingleCharGroup()
		const { modules, groupId, NODE_A, NODE_B, channelId, postMessage } = ctx
		await joinSecondHuman(ctx)

		// 第二真人发言（未 @）不应触发回复
		await postMessage(NODE_B, groupId, channelId, 'hello from second human', [NODE_A])
		await waitUntil(async () => {
			const rows = await modules.queries.listChannelMessages(NODE_A, groupId, channelId, { decrypt: true })
			return rows.some(row => rowText(row).includes('hello from second human'))
		}, 10000, 100)
		await new Promise(resolve => setTimeout(resolve, 800))
		assertEquals(await replyCount(modules, NODE_A, groupId, channelId), 0, 'second human without mention must not fallback-trigger')

		// @ 命中仍触发
		const agentHash = await agentEntityHash(modules, NODE_A, groupId)
		assert(agentHash, 'agent member entityHash resolves')
		await postMessage(NODE_B, groupId, channelId, `@[entity:${agentHash}] ping`, [NODE_A])
		await waitUntil(async () => await replyCount(modules, NODE_A, groupId, channelId) >= 1, 15000, 100)

		// 显式开启 autoReplyFrequency 后，未 @ 也可触发
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { autoReplyFrequency: 1 },
		}, { publishFederation: false })
		await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ctx.ownerSigner.secretKey })

		const before = await replyCount(modules, NODE_A, groupId, channelId)
		await postMessage(NODE_B, groupId, channelId, 'frequency-driven ping', [NODE_A])
		// 回复由 B→A 联邦往返后在 A 侧 fallback 触发；integration 全量并发时 15s 不够，放宽容忍满负载。
		await waitUntil(async () => await replyCount(modules, NODE_A, groupId, channelId) > before, 30000, 100)
	})
})
