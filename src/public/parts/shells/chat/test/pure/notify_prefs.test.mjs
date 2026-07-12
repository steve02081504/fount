/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	describeMentionHit,
	isNotifyMuted,
	resolveEffectiveNotifyPrefs,
	shouldNotifyHumanForMessage,
	saveNotifyPrefs,
} from '../../src/chat/lib/notifyPrefs.mjs'
import { setCared } from '../../src/chat/lib/care.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const GROUP = 'g1'
const CHANNEL = 'default'
const OPERATOR = 'b'.repeat(128)
const AUTHOR = 'c'.repeat(128)

Deno.test('resolveEffectiveNotifyPrefs defaults dm to all', () => {
	const prefs = resolveEffectiveNotifyPrefs('unused-user', GROUP, CHANNEL, { groupMeta: { dmKind: 'ecdh' } })
	assertEquals(prefs.mode, 'all')
})

Deno.test('resolveEffectiveNotifyPrefs defaults group to mentions', () => {
	const prefs = resolveEffectiveNotifyPrefs('unused-user', GROUP, CHANNEL, { groupMeta: {} })
	assertEquals(prefs.mode, 'mentions')
})

Deno.test('isNotifyMuted handles forever and epoch', () => {
	assertEquals(isNotifyMuted({ mutedUntil: true }), true)
	assertEquals(isNotifyMuted({ mutedUntil: Date.now() + 60_000 }), true)
	assertEquals(isNotifyMuted({ mutedUntil: Date.now() - 60_000 }), false)
})

Deno.test('shouldNotifyHumanForMessage care pierces mute', async () => {
	const username = `np-care-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()
	saveNotifyPrefs(username, { [GROUP]: { mutedUntil: true } })
	await setCared(username, OPERATOR, AUTHOR, true)
	const state = { groupMeta: {}, members: {} }
	const probeEvent = {
		mentions: { entityHashes: [], roleIds: [], everyone: false },
		group: { groupId: GROUP },
	}
	const notify = await shouldNotifyHumanForMessage(username, OPERATOR, {
		authorEntityHash: AUTHOR,
		groupId: GROUP,
		channelId: CHANNEL,
		state,
		probeEvent,
		ingress: 'live',
	})
	assertEquals(notify, true)
})

Deno.test('describeMentionHit distinguishes entity role everyone', async () => {
	const state = {
		members: {
			abc123: {
				status: 'active',
				memberKind: 'user',
				memberEntityHash: OPERATOR,
				roles: ['admin'],
			},
		},
	}
	const event = {
		mentions: {
			entityHashes: [OPERATOR],
			roleIds: ['admin'],
			everyone: true,
		},
	}
	assertEquals(await describeMentionHit(event, OPERATOR, state), 'entity')
})
