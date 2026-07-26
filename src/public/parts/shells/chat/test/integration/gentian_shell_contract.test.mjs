/**
 * 壳层契约验收（复诵 / 自裁 / OnError / 主人识别）。
 */
/* global Deno */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createCharBoot,
	createIntegrationBoot,
	seedCharFixture,
	waitUntil,
} from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'gentian_shell_contract'

Deno.test('Gentian OnMessage: owner repeat command replies inline', async () => {
	const username = `gentian-repeat-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { bindBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)
	await bindBridgeIdentity(username, {
		platform: 'telegram',
		platformUserId: '77001',
		entityHash: operatorHash,
		displayName: 'Owner',
	})

	const charAPI = await loadPart(username, `chars/${CHAR}`)
	const platformChatId = 880001 + Math.floor(Math.random() * 1000)
	/** @type {string | undefined} */
	let groupId
	/** @type {object[]} */
	const outbound = []
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 901,
		author: { platformUserId: '77001', displayName: 'Owner' },
		text: '龙胆复诵\n```\nhello gentian\n```',
		timestamp: Date.now(),
	}, async gid => {
		groupId = gid
		registerBridgeOutbound(username, gid, async ({ messageLine }) => {
			outbound.push(messageLine)
			return { platformMessageId: 1 }
		})
	}, 'gentian-bot', CHAR)

	await waitUntil(async () => {
		const session = getVirtualBridgeSession(username, groupId)
		const logs = session?.channels.default?.logs || []
		// fount log 正文为 string；outbound handler 收到的是平台 DTO（{type:'text', content}）
		return logs.some(row => String(row.content || '').includes('hello gentian'))
			|| outbound.some(row => String(row.content?.content || '').includes('hello gentian'))
	}, 15000)
})

Deno.test('Gentian OnMessage: self-destruct calls bridge stopSelf', async () => {
	const username = `gentian-stop-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { handleOwnerCommands } = await import(
		`file://${join(fixturesRoot, 'chars/gentian_shell_contract/trigger/commands.mjs').replace(/\\/g, '/')}`
	)

	const botname = 'gentian-stop-bot'
	let stopCalled = false
	registerBridgeOperations(username, 'telegram', botname, {
		/** 记录自裁是否被调用。 */
		stopSelf: async () => { stopCalled = true },
	}, { charname: CHAR })

	/** @type {object[]} */
	const replies = []
	const result = await handleOwnerCommands({
		content: '龙胆自裁',
		message: {
			/**
			 * @param {object} payload 回复载荷
			 * @returns {Promise<void>}
			 */
			reply: async payload => { replies.push(payload) },
		},
		client: {
			/** @returns {Promise<object>} 模拟 group 对象 */
			group: async () => ({
				bridge: { platform: 'telegram', botname },
			}),
		},
		groupId: 'test-group',
		isFromOwner: true,
		username,
	})

	assertEquals(result, 'exit')
	assert(replies.some(row => String(row.content || '').includes('咱死了')))
	assert(stopCalled)
})

Deno.test('Gentian fixture: OnError routed via dispatchCharError', async () => {
	const username = `gentian-error-${crypto.randomUUID().slice(0, 8)}`
	const boot = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			await seedCharFixture(boot.dataDir, user, CHAR)
		},
	})
	await boot.ensureServer()

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { dispatchCharError } = await import('../../src/chat/session/charError.mjs')

	const char = await loadPart(username, `chars/${CHAR}`)
	const err = new Error('fixture boom')
	const context = { username, source: 'OnMessage', groupId: 'g1', channelId: 'c1' }
	const handled = await dispatchCharError(char, err, context)

	assertEquals(handled, true)
	assert(typeof char.OnError === 'function')
})

Deno.test('Gentian OnMessage: isCaredBy recognizes bound owner not stranger', async () => {
	const username = `gentian-care-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { isCaredBy } = await import('../../src/chat/lib/care.mjs')
	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')

	const selfHash = (await ensureLocalAgentEntityHash(username, CHAR)).toLowerCase()
	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)
	assertEquals(await isCaredBy(username, selfHash, operatorHash), true)

	const strangerHash = bridgeEntityHash('telegram', '999999').toLowerCase()
	assertEquals(await isCaredBy(username, selfHash, strangerHash), false)
})

Deno.test('Gentian Telegram DM: owner call easter egg then plain message triggers GetReply+typing', async () => {
	const username = `gentian-dm-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { bindBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { onMessageProbe } = await import('../fixtures/probes/onMessageProbe.mjs')

	onMessageProbe.reset()
	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)
	await bindBridgeIdentity(username, {
		platform: 'telegram',
		platformUserId: '77002',
		entityHash: operatorHash,
		displayName: 'Owner',
	})

	const charAPI = await loadPart(username, `chars/${CHAR}`)
	const platformChatId = 880100 + Math.floor(Math.random() * 1000)
	const botname = 'gentian-dm-bot'
	/** @type {string | undefined} */
	let groupId
	/** @type {object[]} */
	const outbound = []
	/** @type {object[]} */
	const typingCalls = []
	registerBridgeOperations(username, 'telegram', botname, {
		/** @param {object} payload typing 载荷 */
		sendTyping: async payload => { typingCalls.push(payload) },
	}, { charname: CHAR })

	/**
	 * @param {string} text 入站文本
	 * @param {number} platformMessageId 平台消息 id
	 * @returns {Promise<void>}
	 */
	async function ingest(text, platformMessageId) {
		await bridgeIngestDto(username, charAPI, 'telegram', {
			platform: 'telegram',
			platformChatId,
			chatKind: 'dm',
			platformMessageId,
			author: { platformUserId: '77002', displayName: 'Owner' },
			text,
			timestamp: Date.now(),
		}, async gid => {
			groupId = gid
			registerBridgeOutbound(username, gid, async ({ messageLine }) => {
				outbound.push(messageLine)
				return { platformMessageId: outbound.length }
			})
		}, botname, CHAR)
	}

	await ingest('龙胆', 901)
	await waitUntil(() => {
		const session = getVirtualBridgeSession(username, groupId)
		const logs = session?.channels.default?.logs || []
		return logs.some(row => String(row.content || '') === '主人')
			|| outbound.some(row => String(row.content?.content || '') === '主人')
	}, 15000)

	const sessionAfterCall = getVirtualBridgeSession(username, groupId)
	assertEquals(sessionAfterCall?.chatKind, 'dm')
	assertEquals(onMessageProbe.replies, 0)
	assertEquals(typingCalls.length, 0)
	assert(onMessageProbe.decisions.some(row => row.reason === 'command:handled' && row.isFromOwner === true))

	const repliesBefore = onMessageProbe.replies
	await ingest('活着吗', 902)
	await waitUntil(() => outbound.some(row =>
		String(row.content?.content || '').includes('gentian_shell_contract reply')), 15000)

	assert(onMessageProbe.replies > repliesBefore)
	assert(typingCalls.length >= 1)
	const lastDecision = onMessageProbe.decisions.at(-1)
	assertEquals(lastDecision?.isFromOwner, true)
	assertEquals(lastDecision?.isDm, true)
	assertEquals(lastDecision?.wantsReply, true)
})
