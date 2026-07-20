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
	const { bindBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

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
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 901,
		author: { platformUserId: '77001', displayName: 'Owner' },
		text: '龙胆复诵\n```\nhello gentian\n```',
		timestamp: Date.now(),
	}, async gid => { groupId = gid }, 'gentian-bot', CHAR)

	const channelId = await getDefaultChannelId(username, groupId)
	await waitUntil(async () => {
		const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 30 })
		return messages.some(row => String(row.content?.content || '').includes('hello gentian'))
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
