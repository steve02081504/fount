/**
 * 群组通话卡片生命周期集成测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('call session posts and edits call card then ends', async () => {
	const username = `call-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 *
		 * @param user
		 */
		/**
		 * @param {string} user replica
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const {
		beginCallSession,
		updateCallRoster,
		endCallSession,
		getLiveCallSession,
	} = await import('../../src/chat/call/session.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { mergeChannelMessagesForDisplay } = await import('../../public/shared/messageMerge.mjs')

	const groupId = await newGroup(username, { name: 'call-group' })
	const channelId = await getDefaultChannelId(username, groupId)
	const initiator = await resolveOperatorEntityHash(username)
	assert(initiator)

	const session = await beginCallSession(username, groupId, channelId, initiator)
	assertEquals(session.status, 'ongoing')
	assert(session.messageEventId)

	await updateCallRoster(groupId, channelId, [
		{ entityHash: initiator, senderId: 'a'.repeat(32) },
		{ entityHash: 'b'.repeat(128), senderId: 'c'.repeat(32) },
	])
	const live = getLiveCallSession(groupId, channelId)
	assertEquals(live.everJoined.length, 2)

	await endCallSession(groupId, channelId)
	assertEquals(getLiveCallSession(groupId, channelId), null)

	// message_edit 会在 checkpoint rebuild 时从 events.jsonl 折叠掉；断言看频道侧车折叠后的展示行
	const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: 100 })
	const card = mergeChannelMessagesForDisplay(lines).find(row =>
		row.eventId === session.messageEventId || row.content?.type === 'call',
	)
	assert(card)
	assertEquals(card.content?.type, 'call')
	assertEquals(card.content?.status, 'ended')
	assert(Array.isArray(card.content?.participants))
	assert(card.content.participants.includes(initiator.toLowerCase()))
	assertEquals(card.content?.current?.length ?? 0, 0)
	assert(card.content?.duration >= 0)
})

Deno.test('dropActiveCallsForGroup clears active.json for that group', async () => {
	const username = `call-drop-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user replica
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
		},
	})
	await ensureServer()

	const { activeCallsPath } = await import('../../src/chat/lib/paths.mjs')
	const { saveJsonFile } = await import('../../../../../../scripts/json_loader.mjs')
	const { dirname } = await import('node:path')
	const fs = await import('node:fs')
	const { dropActiveCallsForGroup } = await import('../../src/chat/call/session.mjs')

	const keepId = crypto.randomUUID()
	const dropId = crypto.randomUUID()
	const path = activeCallsPath(username)
	fs.mkdirSync(dirname(path), { recursive: true })
	saveJsonFile(path, {
		calls: {
			[keepId]: {
				callId: keepId,
				username,
				groupId: 'keep-group',
				channelId: 'default',
				initiator: 'a'.repeat(128),
				messageEventId: 'b'.repeat(64),
				startedAt: Date.now(),
				everJoined: [],
				status: 'ongoing',
			},
			[dropId]: {
				callId: dropId,
				username,
				groupId: 'drop-group',
				channelId: 'default',
				initiator: 'a'.repeat(128),
				messageEventId: 'c'.repeat(64),
				startedAt: Date.now(),
				everJoined: [],
				status: 'ongoing',
			},
		},
	})

	dropActiveCallsForGroup(username, 'drop-group')
	const remaining = JSON.parse(fs.readFileSync(path, 'utf8'))
	assertEquals(Object.keys(remaining.calls), [keepId])
})

Deno.test('reconcile drops orphan when group cannot authorize edit', async () => {
	const username = `call-orphan-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user replica
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
		},
	})
	await ensureServer()

	const { activeCallsPath } = await import('../../src/chat/lib/paths.mjs')
	const { saveJsonFile } = await import('../../../../../../scripts/json_loader.mjs')
	const { dirname } = await import('node:path')
	const fs = await import('node:fs')
	const { reconcileOrphanedCalls } = await import('../../src/chat/call/session.mjs')

	const callId = crypto.randomUUID()
	const path = activeCallsPath(username)
	fs.mkdirSync(dirname(path), { recursive: true })
	saveJsonFile(path, {
		calls: {
			[callId]: {
				callId,
				username,
				groupId: 'missing-group-for-orphan',
				channelId: 'default',
				initiator: 'a'.repeat(128),
				messageEventId: 'b'.repeat(64),
				startedAt: Date.now() - 60_000,
				everJoined: ['a'.repeat(128)],
				status: 'ongoing',
			},
		},
	})

	const n = await reconcileOrphanedCalls(username)
	assert(n >= 1)
	const remaining = JSON.parse(fs.readFileSync(path, 'utf8'))
	assertEquals(Object.keys(remaining.calls || {}).length, 0)
})

Deno.test('channelContent accepts call type', async () => {
	const { channelMessageContentObject } = await import('../../public/shared/channelContent.mjs')
	const content = channelMessageContentObject({
		type: 'call',
		callId: 'x',
		status: 'ongoing',
		startedAt: Date.now(),
		initiator: 'a'.repeat(128),
		participants: ['a'.repeat(128)],
		current: ['a'.repeat(128)],
	})
	assertEquals(content.type, 'call')
})

Deno.test('concurrent begin + roster update yields one call card', async () => {
	const username = `call-race-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user replica
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const {
		beginCallSession,
		updateCallRoster,
		endCallSession,
	} = await import('../../src/chat/call/session.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { mergeChannelMessagesForDisplay } = await import('../../public/shared/messageMerge.mjs')

	const groupId = await newGroup(username, { name: 'call-race-group' })
	const channelId = await getDefaultChannelId(username, groupId)
	const initiator = await resolveOperatorEntityHash(username)
	assert(initiator)
	const peer = 'd'.repeat(128)

	const [session] = await Promise.all([
		beginCallSession(username, groupId, channelId, initiator),
		updateCallRoster(groupId, channelId, [
			{ entityHash: initiator, senderId: 'a'.repeat(32) },
			{ entityHash: peer, senderId: 'b'.repeat(32) },
		]),
	])
	assert(session?.messageEventId)
	assertEquals(session.status, 'ongoing')

	await endCallSession(groupId, channelId)

	const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: 100 })
	const callCards = mergeChannelMessagesForDisplay(lines).filter(row => row.content?.type === 'call')
	assertEquals(callCards.length, 1)
	assertEquals(callCards[0].content?.status, 'ended')
	assert(callCards[0].content.participants.includes(initiator.toLowerCase()))
	assert(callCards[0].content.participants.includes(peer))
})
