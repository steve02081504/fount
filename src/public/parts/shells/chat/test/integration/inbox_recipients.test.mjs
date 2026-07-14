/**
 * per-recipient inbox + 触发管线集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { onMessageProbeState } from '../fixtures/on_message_probe_state.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_YES = 'on_message_yes'
const CHAR_NO = 'on_message_no'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @param {string[]} chars 角色 fixture 名
 * @returns {Promise<void>}
 */
async function seedCharFixtures(dataDir, username, chars) {
	const userRoot = join(dataDir, 'users', username)
	for (const name of chars) {
		const from = join(fixturesRoot, 'chars', name)
		const to = join(userRoot, 'chars', name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object[]>}
 */
async function listMessages(username, groupId, channelId) {
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	return readChannelMessagesForUser(username, groupId, channelId, { limit: 100 })
}

/**
 * @param {() => Promise<boolean>} predicate 条件
 * @param {number} [timeoutMs] 超时
 * @returns {Promise<void>}
 */
async function waitUntil(predicate, timeoutMs = 8000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise(resolve => setTimeout(resolve, 80))
	}
	throw new Error('waitUntil timeout')
}

Deno.test('per-recipient inbox: @operator and @agent', async () => {
	const username = `inbox-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbeState()
	probe.reset()
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_inbox_recip_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixtures(dataDir, user, [CHAR_YES])
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { dispatchMessageFanout } = await import('../../src/chat/dag/messageFanout.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')

	const groupId = await newGroup(username, { name: 'inbox-recip' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_YES, username)

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	const agentHash = (await ensureLocalAgentEntityHash(username, CHAR_YES)).toLowerCase()
	assert(operatorHash)
	assert(agentHash)

	const senderKey = 'd'.repeat(64)
	const at = Date.now()
	await dispatchMessageFanout(username, groupId, channelId, {
		type: 'message',
		eventId: `${'ab'.repeat(32)}`,
		sender: senderKey,
		content: { type: 'text', content: `ping @[entity:${operatorHash}] and @[entity:${agentHash}]` },
		hlc: { wall: at },
	}, { ingress: 'backfill' })

	const operatorPage = await listChatInbox(username, operatorHash, { limit: 10 })
	assertEquals(operatorPage.items.length, 1)
	assertEquals(operatorPage.items[0].kind, 'mention')

	const agentPage = await listChatInbox(username, agentHash, { limit: 10 })
	assertEquals(agentPage.items.length, 1)
	assertEquals(agentPage.items[0].kind, 'mention')
})

Deno.test('@Charname plain text does not trigger char reply', async () => {
	const username = `inbox-char-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbeState()
	probe.reset()
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_inbox_charname_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixtures(dataDir, user, [CHAR_YES])
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'no-charname-trigger' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_YES, username)
	probe.returnValue = false

	await postChannelMessage(username, groupId, channelId, { text: `@${CHAR_YES} hello` })
	await new Promise(resolve => setTimeout(resolve, 300))

	const messages = await listMessages(username, groupId, channelId)
	assert(!messages.some(row => String(row.content?.content || '').includes('on_message_yes reply')))
})

Deno.test('trigger pipeline: OnMessage true speaks without mention; false stays silent', async () => {
	const username = `trig-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbeState()
	probe.reset()
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_trigger_pipe_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixtures(dataDir, user, [CHAR_YES, CHAR_NO])
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'trigger-pipe' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_YES, username)
	await addchar(groupId, CHAR_NO, username)
	probe.returnValue = true

	await postChannelMessage(username, groupId, channelId, { text: 'no mention ping' })
	await waitUntil(async () => probe.events.length > 0, 5000)
	await waitUntil(async () => {
		const messages = await listMessages(username, groupId, channelId)
		return messages.some(row => String(row.content?.content || '').includes('on_message_yes reply'))
	}, 15000)

	const event = probe.events.at(-1)
	assert(event)
	assert(event.mentions)
	assert(event.group)
	assertEquals(event.group.kind, 'group')
	assertEquals('mentioned' in event, false)
	assertEquals('onlineCount' in event, false)

	probe.reset()
	await postChannelMessage(username, groupId, channelId, { text: 'second ping for no-char' })
	await new Promise(resolve => setTimeout(resolve, 400))
	const messages2 = await listMessages(username, groupId, channelId)
	const noReplies = messages2.filter(row => String(row.content?.content || '').includes('on_message_no reply'))
	assertEquals(noReplies.length, 0)
})

Deno.test('ECDH DM group projects kind=dm and boundPeerEntityHash in OnMessage', async () => {
	const username = `trig-dm-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbeState()
	probe.reset()
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_trigger_dm_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixtures(dataDir, user, [CHAR_YES])
		},
	})
	await ensureServer()

	const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
	const { randomKeyPair } = await import('npm:@steve02081504/fount-p2p/crypto')
	const { createEcdhDmGroup } = await import('../../src/chat/dm/index.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const myPub = await ensureOperatorPubKey(username)
	const peer = await randomKeyPair()
	const peerPub = Buffer.from(peer.publicKey).toString('hex')
	const dm = await createEcdhDmGroup(username, myPub, peerPub)
	await addchar(dm.groupId, CHAR_YES, username)
	probe.returnValue = false

	await postChannelMessage(username, dm.groupId, dm.defaultChannelId, { text: 'dm ping' })
	await waitUntil(async () => probe.events.length > 0, 10000)

	const event = probe.events.at(-1)
	assertEquals(event.group.kind, 'dm')
	assertNotEquals(event.group.boundPeerEntityHash, undefined)
})
