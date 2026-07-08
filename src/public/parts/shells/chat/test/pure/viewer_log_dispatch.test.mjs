/* global Deno */
import { agentEntityHash } from 'fount/scripts/p2p/entity_id.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	applyWorldChatLogView,
	resolveViewerRoles,
} from '../../src/chat/session/viewerLog.mjs'

const baseLog = [
	{ id: 'a', content: 'visible' },
	{ id: 'b', content: 'hidden-marker' },
]

Deno.test('applyWorldChatLogView prefers GetChatLogForViewer', async () => {
	const filtered = [baseLog[0]]
	let legacyCalled = false
	/** @type {(req: object, viewer: object) => Promise<object[]>} */
	const getForViewer = async (_req, viewer) => {
		assertEquals(viewer.kind, 'char')
		return filtered
	}
	/** @type {() => Promise<object[]>} */
	const getForCharname = async () => {
		legacyCalled = true
		return baseLog
	}
	const arg = {
		chat_log: baseLog,
		world: {
			interfaces: {
				chat: {
					GetChatLogForViewer: getForViewer,
					GetChatLogForCharname: getForCharname,
				},
			},
		},
	}
	const result = await applyWorldChatLogView(arg, {
		kind: 'char',
		memberId: 'm1',
		ownerUsername: 'u',
		channelId: 'c',
		charname: 'alice',
	})
	assertEquals(result, filtered)
	assertEquals(legacyCalled, false)
})

Deno.test('applyWorldChatLogView falls back to GetChatLogForCharname for char viewer', async () => {
	const filtered = [baseLog[0]]
	/** @type {(req: object, charname: string) => Promise<object[]>} */
	const getForCharname = async (_req, charname) => {
		assertEquals(charname, 'alice')
		return filtered
	}
	const arg = {
		chat_log: baseLog,
		world: {
			interfaces: {
				chat: { GetChatLogForCharname: getForCharname },
			},
		},
	}
	const result = await applyWorldChatLogView(arg, {
		kind: 'char',
		memberId: 'm1',
		ownerUsername: 'u',
		channelId: 'c',
		charname: 'alice',
	})
	assertEquals(result, filtered)
})

Deno.test('applyWorldChatLogView passes through when world has no chatlog hooks', async () => {
	const arg = { chat_log: baseLog, world: { interfaces: { chat: {} } } }
	assertEquals(await applyWorldChatLogView(arg, {
		kind: 'user',
		memberId: 'm1',
		ownerUsername: 'u',
		channelId: 'c',
	}), baseLog)
})

Deno.test('applyWorldChatLogView does not call GetChatLogForCharname for user viewer', async () => {
	let legacyCalled = false
	/** @type {() => Promise<object[]>} */
	const getForCharname = async () => {
		legacyCalled = true
		return []
	}
	const arg = {
		chat_log: baseLog,
		world: {
			interfaces: {
				chat: { GetChatLogForCharname: getForCharname },
			},
		},
	}
	assertEquals(await applyWorldChatLogView(arg, {
		kind: 'user',
		memberId: 'm1',
		ownerUsername: 'u',
		channelId: 'c',
	}), baseLog)
	assertEquals(legacyCalled, false)
})

Deno.test('resolveViewerRoles: char and user paths from members', async () => {
	const node = 'a'.repeat(64)
	const char = 'viewer_char'
	const agentKey = agentEntityHash(node, `chars/${char}`)
	const userKey = 'b'.repeat(64)
	const state = {
		members: {
			[agentKey]: {
				memberKind: 'agent',
				charname: char,
				status: 'active',
				roles: ['@everyone', 'admin'],
			},
			[userKey]: {
				memberKind: 'user',
				status: 'active',
				roles: ['@everyone', 'founder'],
			},
		},
	}
	assertEquals(
		await resolveViewerRoles(state, { charname: char, replicaUsername: 'u', groupId: 'g' }),
		['@everyone', 'admin'],
	)
	assertEquals(
		await resolveViewerRoles(state, { replicaUsername: 'u', groupId: 'g', memberKey: userKey }),
		['@everyone', 'founder'],
	)
	assertEquals(
		await resolveViewerRoles(state, { charname: 'missing', replicaUsername: 'u', groupId: 'g' }),
		[],
	)
	const noRolesState = {
		members: {
			[agentKey]: { memberKind: 'agent', charname: char, status: 'active' },
		},
	}
	assertEquals(
		await resolveViewerRoles(noRolesState, { charname: char, replicaUsername: 'u', groupId: 'g' }),
		['@everyone'],
	)
})
