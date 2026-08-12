/**
 * 本机并发 append 不得因锁外算 tip 分叉，导致 authzFold 丢掉治理事件。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createCharBoot } from '../harness.mjs'

const CHAR = 'viewer_agent'

Deno.test('role_assign sticks while auto-reply is in flight', async () => {
	const username = `conc-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { computeFederatableDagTipIds } = await import('../../src/chat/dag/eventTypes.mjs')
	const { resolveActiveAgentMemberKeyByCharname } = await import('../../src/group/access.mjs')

	const groupId = await newGroup(username, { name: 'concurrent-assign' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR, username)

	const { state } = await getState(username, groupId)
	const memberKey = resolveActiveAgentMemberKeyByCharname(state, CHAR)
	assert(memberKey)

	await postChannelMessage(username, groupId, channelId, { text: 'hello' })
	await appendSignedLocalEvent(username, groupId, {
		type: 'role_create',
		timestamp: Date.now(),
		content: {
			roleId: 'moderator',
			name: 'Moderator',
			color: '#3498db',
			position: 50,
			permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true },
			isDefault: false,
			isHoisted: false,
		},
	}, { publishFederation: false })
	await appendSignedLocalEvent(username, groupId, {
		type: 'role_assign',
		timestamp: Date.now(),
		content: { targetMemberKey: memberKey, roleId: 'moderator' },
	}, { publishFederation: false })

	const { state: after, events } = await getState(username, groupId)
	assert(after.roles?.moderator, 'role_create did not materialize')
	assert(
		(after.members?.[memberKey]?.roles || []).includes('moderator'),
		`role_assign dropped on ${memberKey}: ${JSON.stringify(after.members?.[memberKey]?.roles)}`,
	)
	const tips = computeFederatableDagTipIds(events)
	assertEquals(tips.length, 1, `local appends forked; tips=${JSON.stringify(tips)}`)
})

Deno.test('concurrent local appends share one tip and both apply', async () => {
	const username = `conc2-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { computeFederatableDagTipIds } = await import('../../src/chat/dag/eventTypes.mjs')

	const groupId = await newGroup(username, { name: 'concurrent-tips' })
	const channelId = await getDefaultChannelId(username, groupId)
	const opts = { publishFederation: false }

	for (let i = 0; i < 8; i++) {
		const roleId = `r${i}`
		await Promise.all([
			appendSignedLocalEvent(username, groupId, {
				type: 'role_create',
				timestamp: Date.now(),
				content: {
					roleId,
					name: roleId,
					color: '#3498db',
					position: 10 + i,
					permissions: { VIEW_CHANNEL: true },
					isDefault: false,
					isHoisted: false,
				},
			}, opts),
			appendSignedLocalEvent(username, groupId, {
				type: 'message',
				channelId,
				timestamp: Date.now(),
				content: { content: `concurrent ${i}` },
			}, opts),
		])
		const { state, events } = await getState(username, groupId)
		assert(state.roles?.[roleId], `role_create ${roleId} dropped by concurrent append`)
		assertEquals(
			events.filter(event => event.type === 'message').length,
			i + 1,
			`message ${i} missing after concurrent append`,
		)
		const tips = computeFederatableDagTipIds(events)
		assertEquals(tips.length, 1, `round ${i} forked; tips=${JSON.stringify(tips)}`)
	}
})
