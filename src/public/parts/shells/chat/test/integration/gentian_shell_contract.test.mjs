/**
 * 壳层契约验收（复诵 / 自裁 / OnError / 主人识别）。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'gentian_shell_contract'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedGentianFixture(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const from = join(fixturesRoot, 'chars', CHAR)
	const to = join(userRoot, 'chars', CHAR)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
}

/**
 * @param {() => Promise<boolean>} predicate 条件
 * @param {number} [timeoutMs] 超时
 */
async function waitUntil(predicate, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('waitUntil timeout')
}

Deno.test('Gentian onMessage: owner repeat command replies inline', async () => {
	const username = `gentian-repeat-${crypto.randomUUID().slice(0, 8)}`
	const boot = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_gentian_repeat_',
		minP2pNode: true,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedGentianFixture(boot.dataDir, user)
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
	})
})

Deno.test('Gentian onMessage: self-destruct calls bridge stopSelf', async () => {
	const username = `gentian-stop-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_gentian_stop_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOps } = await import('../../src/chat/bridge/ops.mjs')
	const { handleOwnerCommands } = await import(
		`file://${join(fixturesRoot, 'chars/gentian_shell_contract/trigger/commands.mjs').replace(/\\/g, '/')}`
	)

	const botname = 'gentian-stop-bot'
	let stopCalled = false
	registerBridgeOps(username, 'telegram', botname, {
		/**
		 *
		 */
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
		tempDirPrefix: 'fount_gentian_error_',
		minP2pNode: true,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			await seedGentianFixture(boot.dataDir, user)
		},
	})
	await boot.ensureServer()

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { dispatchCharError } = await import('../../src/chat/session/charError.mjs')

	const char = await loadPart(username, `chars/${CHAR}`)
	const err = new Error('fixture boom')
	const context = { username, source: 'onMessage', groupId: 'g1', channelId: 'c1' }
	const handled = await dispatchCharError(char, err, context)

	assertEquals(handled, true)
	assert(typeof char.OnError === 'function')
})

Deno.test('Gentian onMessage: isCaredBy recognizes bound owner not stranger', async () => {
	const username = `gentian-care-${crypto.randomUUID().slice(0, 8)}`
	const boot = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_gentian_care_',
		minP2pNode: true,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedGentianFixture(boot.dataDir, user)
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()

	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getLocalNodeHash, resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { isCaredBy } = await import('../../src/chat/lib/care.mjs')
	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')

	const selfHash = agentEntityHash(getLocalNodeHash(), `chars/${CHAR}`).toLowerCase()
	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)
	assertEquals(await isCaredBy(username, selfHash, operatorHash), true)

	const strangerHash = bridgeEntityHash('telegram', '999999').toLowerCase()
	assertEquals(await isCaredBy(username, selfHash, strangerHash), false)
})
