/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	collectKnownPeerNodeHashes,
	evaluateShunConsensusPure,
	resolveShunForNodeHashRequester,
} from '../../src/chat/federation/shun.mjs'
import { SHUN_CONSENSUS_WINDOW_MS } from '../../src/group/groupShunState.mjs'

const peers = [
	'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
]
const self = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
const now = 1_000_000

Deno.test('evaluateShunConsensusPure: all known peers shunned within window => suspected', () => {
	const shuns = {
		[peers[0]]: now - 1000,
		[peers[1]]: now - 2000,
	}
	const { suspected, shunnedBy } = evaluateShunConsensusPure(peers, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
	assertEquals(suspected, true)
	assertEquals(shunnedBy.length, 2)
})

Deno.test('evaluateShunConsensusPure: missing one peer shun => not suspected', () => {
	const shuns = { [peers[0]]: now - 1000 }
	const { suspected } = evaluateShunConsensusPure(peers, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
	assertEquals(suspected, false)
})

Deno.test('evaluateShunConsensusPure: expired shun outside window => not suspected', () => {
	const shuns = {
		[peers[0]]: now - SHUN_CONSENSUS_WINDOW_MS - 1,
		[peers[1]]: now - 1000,
	}
	const { suspected } = evaluateShunConsensusPure(peers, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
	assertEquals(suspected, false)
})

Deno.test('evaluateShunConsensusPure: single peer group one shun => suspected', () => {
	const single = [peers[0]]
	const { suspected } = evaluateShunConsensusPure(single, { [peers[0]]: now }, now, SHUN_CONSENSUS_WINDOW_MS)
	assertEquals(suspected, true)
})

Deno.test('evaluateShunConsensusPure: no known peers => not suspected', () => {
	const { suspected } = evaluateShunConsensusPure([], { [peers[0]]: now }, now, SHUN_CONSENSUS_WINDOW_MS)
	assertEquals(suspected, false)
})

Deno.test('collectKnownPeerNodeHashes collects active member home nodes excluding self', () => {
	const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const state = {
		members: {
			[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
			ccc: { status: 'active', homeNodeHash: other, memberKind: 'user' },
			ddd: {
				status: 'banned',
				homeNodeHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
				memberKind: 'user',
			},
		},
	}
	assertEquals(collectKnownPeerNodeHashes(state, self), [other])
})

Deno.test('collectKnownPeerNodeHashes prefers roster peers over stale member home nodes', () => {
	const stale = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const online = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
	const state = {
		members: {
			[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
			ccc: { status: 'active', homeNodeHash: stale, memberKind: 'user' },
			ddd: { status: 'active', homeNodeHash: online, memberKind: 'user' },
		},
	}
	assertEquals(collectKnownPeerNodeHashes(state, self, [self, online]), [online])
})

Deno.test('resolveShunForNodeHashRequester: active member home node => no shun', () => {
	const nodeB = peers[1]
	const pkB = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
	const state = {
		members: {
			[pkB]: { status: 'active', homeNodeHash: nodeB, memberKind: 'user' },
		},
	}
	assertEquals(resolveShunForNodeHashRequester(state, () => false, nodeB), { shun: false, reason: null })
})

Deno.test('resolveShunForNodeHashRequester: banned member home node => shun not_a_member', () => {
	const nodeB = peers[1]
	const pkB = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
	const state = {
		members: {
			[pkB]: { status: 'banned', homeNodeHash: nodeB, memberKind: 'user' },
		},
	}
	assertEquals(resolveShunForNodeHashRequester(state, () => false, nodeB), { shun: true, reason: 'not_a_member' })
})

Deno.test('resolveShunForNodeHashRequester: bannedNodes set => shun not_a_member', () => {
	const nodeB = peers[1]
	const state = { members: {}, bannedNodes: new Set([nodeB]) }
	assertEquals(resolveShunForNodeHashRequester(state, () => false, nodeB), { shun: true, reason: 'not_a_member' })
})

Deno.test('resolveShunForNodeHashRequester: unknown node => no shun', () => {
	const nodeA = peers[0]
	assertEquals(resolveShunForNodeHashRequester({ members: {} }, () => false, nodeA), { shun: false, reason: null })
})
