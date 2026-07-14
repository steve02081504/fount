/**
 * 通知偏好矩阵、@here 时序、care 穿透、vote_closed inbox。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {object} messageLine 消息行
 * @param {{ ingress?: string }} [options]
 * @returns {Promise<void>}
 */
async function fanout(username, groupId, channelId, messageLine, options = {}) {
	const { dispatchMessageFanout } = await import('../../src/chat/dag/messageFanout.mjs')
	await dispatchMessageFanout(username, groupId, channelId, messageLine, options)
}

Deno.test('notify prefs: group mentions mode skips message row without @', async () => {
	const username = `nf-mentions-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')

	const groupId = await newGroup(username, { name: 'nf-mentions' })
	const channelId = await getDefaultChannelId(username, groupId)
	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()

	await fanout(username, groupId, channelId, {
		type: 'message',
		eventId: `${'aa'.repeat(32)}`,
		sender: 'bb'.repeat(32),
		content: { type: 'text', content: 'plain hello' },
		hlc: { wall: Date.now() },
	}, { ingress: 'live' })

	const page = await listChatInbox(username, operatorHash, { limit: 10 })
	assertEquals(page.items.length, 0)
})

Deno.test('notify prefs: mode all appends message row', async () => {
	const username = `nf-all-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')
	const { saveNotifyPrefs } = await import('../../src/chat/lib/notifyPrefs.mjs')

	const groupId = await newGroup(username, { name: 'nf-all' })
	const channelId = await getDefaultChannelId(username, groupId)
	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	saveNotifyPrefs(username, { [groupId]: { mode: 'all' } })

	await fanout(username, groupId, channelId, {
		type: 'message',
		eventId: `${'cc'.repeat(32)}`,
		sender: 'dd'.repeat(32),
		content: { type: 'text', content: 'broadcast ping' },
		hlc: { wall: Date.now() },
	}, { ingress: 'live' })

	const page = await listChatInbox(username, operatorHash, { limit: 10 })
	assertEquals(page.items.length, 1)
	assertEquals(page.items[0].kind, 'message')
})

Deno.test('care pierces mute for care inbox row', async () => {
	const username = `nf-care-${crypto.randomUUID().slice(0, 8)}`
	const CHAR_YES = 'on_message_yes'
	const { cp, mkdir } = await import('node:fs/promises')
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/entity_identity.mjs')
			await ensureOperatorPubKey(user)
			const from = join(fixturesRoot, 'chars', CHAR_YES)
			const to = join(dataDir, 'users', user, 'chars', CHAR_YES)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')
	const { saveNotifyPrefs } = await import('../../src/chat/lib/notifyPrefs.mjs')
	const { setCared } = await import('../../src/chat/lib/care.mjs')

	const groupId = await newGroup(username, { name: 'nf-care' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_YES, username)
	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	const agentHash = (await ensureLocalAgentEntityHash(username, CHAR_YES)).toLowerCase()
	const { state } = await getState(username, groupId)
	const charMemberKey = Object.keys(state.members).find(key => state.members[key]?.charname === CHAR_YES)
	saveNotifyPrefs(username, { [groupId]: { mutedUntil: true } })
	await setCared(username, operatorHash, agentHash, true)

	await fanout(username, groupId, channelId, {
		type: 'message',
		eventId: `${'ff'.repeat(32)}`,
		sender: charMemberKey,
		content: { type: 'text', content: 'cared author speaks' },
		hlc: { wall: Date.now() },
	}, { ingress: 'live' })

	const page = await listChatInbox(username, operatorHash, { limit: 10, kinds: ['care'] })
	assertEquals(page.items.length, 1)
	assertEquals(page.items[0].kind, 'care')
})

Deno.test('@[here] live hits everyone mention; backfill does not', async () => {
	const username = `nf-here-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { buildMentionsFromMessageLine } = await import('../../src/chat/dag/messageFanout.mjs')
	const { messageMentionsEntity } = await import('../../src/chat/lib/mentionFacts.mjs')
	const { memberEntityHash } = await import('../../src/chat/lib/entity.mjs')

	const groupId = await newGroup(username, { name: 'nf-here' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { state } = await getState(username, groupId)
	const senderKey = Object.keys(state.members).find(key => state.members[key]?.status === 'active')
	assert(senderKey)
	const memberHash = memberEntityHash(state.members[senderKey])?.toLowerCase()
	assert(memberHash)

	const messageLine = {
		type: 'message',
		eventId: `${'11'.repeat(32)}`,
		sender: senderKey,
		content: { type: 'text', content: 'wake @[role:here]' },
		hlc: { wall: Date.now() },
	}
	const liveMentions = buildMentionsFromMessageLine(channelId, messageLine, state, { ingress: 'live' })
	const backMentions = buildMentionsFromMessageLine(channelId, messageLine, state, { ingress: 'backfill' })
	assertEquals(liveMentions.everyone, true)
	assertEquals(backMentions.everyone, false)

	const probe = extra => ({
		mentions: extra,
		group: { groupId },
		chatReplyRequest: { username },
	})
	assertEquals(await messageMentionsEntity(probe(liveMentions), memberHash), true)
	assertEquals(await messageMentionsEntity(probe(backMentions), memberHash), false)
})

Deno.test('fireVoteClosed appends vote_closed inbox row for operator', async () => {
	const username = `nf-vote-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')
	const { fireVoteClosed } = await import('../../src/chat/lib/voteDeadlineWatcher.mjs')

	const groupId = await newGroup(username, { name: 'nf-vote' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { state } = await getState(username, groupId)
	const senderKey = Object.keys(state.members).find(key => state.members[key]?.status === 'active') || '33'.repeat(32)

	const event = await appendSignedLocalEvent(username, groupId, {
		type: 'message',
		channelId,
		timestamp: Date.now(),
		content: {
			type: 'vote',
			question: 'pick one',
			options: ['a', 'b'],
			deadline: new Date(Date.now() + 60_000).toISOString(),
		},
	})
	const ballotId = event.id
	const { state: afterVote } = await getState(username, groupId)
	assert(afterVote.voteBallots?.[ballotId], 'vote ballot should materialize with plaintext vote metadata')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	await fireVoteClosed(username, groupId, channelId, ballotId)

	const page = await listChatInbox(username, operatorHash, { limit: 10, kinds: ['vote_closed'] })
	assertEquals(page.items.length, 1)
	assertEquals(page.items[0].kind, 'vote_closed')
	assertEquals(page.items[0].ballotId, ballotId)
})
