/* global Deno */
import { agentEntityHash } from 'fount/scripts/p2p/entity_id.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	applyPersonaChatLogView,
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

Deno.test('applyPersonaChatLogView filters via GetChatLogForViewer', async () => {
	const filtered = [baseLog[0]]
	const arg = {
		chat_log: baseLog,
		user: {
			interfaces: {
				chat: {
					/**
					 * @returns {Promise<object[]>} 过滤结果
					 */
					GetChatLogForViewer: async () => filtered,
				},
			},
		},
	}
	assertEquals(await applyPersonaChatLogView(arg, {
		kind: 'user',
		memberId: 'm1',
		ownerUsername: 'u',
		channelId: 'c',
	}), filtered)
})

Deno.test('applyPersonaChatLogView passes through without hook', async () => {
	const arg = {
		chat_log: baseLog,
		user: { interfaces: { chat: {} } },
	}
	assertEquals(await applyPersonaChatLogView(arg, {
		kind: 'user',
		memberId: 'm1',
		ownerUsername: 'u',
		channelId: 'c',
	}), baseLog)
})

Deno.test('projectViewerEntriesToRows drops hidden and rewrites text', async () => {
	const { projectViewerEntriesToRows } = await import('../../src/chat/session/viewerLogProject.mjs')
	const rawLines = [
		{
			type: 'message',
			eventId: 'e1',
			content: { type: 'text', content: 'keep-me' },
		},
		{
			type: 'message',
			eventId: 'e2',
			content: { type: 'text', content: 'hide-me' },
		},
		{
			type: 'message',
			eventId: 'e3',
			content: { type: 'text', content: 'rewrite-src' },
		},
		{
			type: 'vote_cast',
			eventId: 'v1',
			content: { ballotId: 'e1', choice: 'a' },
		},
	]
	const entries = [
		{ content: 'keep-me', extension: { dagEventId: 'e1' } },
		{ content: 'rewrite-dst', content_for_show: 'rewrite-dst', extension: { dagEventId: 'e3' } },
	]
	const rows = projectViewerEntriesToRows(rawLines, entries)
	assertEquals(rows.map(row => row.eventId), ['e1', 'e3', 'v1'])
	assertEquals(rows[1].content.content, 'rewrite-dst')
	assertEquals(rows[1].extension.viewerRewritten, true)
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
