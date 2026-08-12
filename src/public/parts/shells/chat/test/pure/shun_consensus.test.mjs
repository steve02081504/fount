/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { verifyPullAttestationSignatureForMember } from '../../src/chat/federation/pullAttestation.mjs'
import {
	collectKnownPeerNodeHashes,
	evaluateShunConsensusPure,
	resolveShunForNodeHashRequester,
	resolveShunForPubKeyRequester,
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

Deno.test('collectKnownPeerNodeHashes intersects roster with active member homes excluding self', () => {
	const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const banned = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
	const state = {
		members: {
			[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
			ccc: { status: 'active', homeNodeHash: other, memberKind: 'user' },
			ddd: {
				status: 'banned',
				homeNodeHash: banned,
				memberKind: 'user',
			},
		},
	}
	assertEquals(collectKnownPeerNodeHashes(state, self, [self, other, banned]), [other])
})

Deno.test('collectKnownPeerNodeHashes uses empty roster for null or empty rosterNodeHashes', () => {
	const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const state = {
		members: {
			[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
			ccc: { status: 'active', homeNodeHash: other, memberKind: 'user' },
		},
	}
	assertEquals(collectKnownPeerNodeHashes(state, self, null), [])
	assertEquals(collectKnownPeerNodeHashes(state, self, undefined), [])
	assertEquals(collectKnownPeerNodeHashes(state, self), [])
	assertEquals(collectKnownPeerNodeHashes(state, self, []), [])
})

Deno.test('collectKnownPeerNodeHashes prefers roster peers over stale member home nodes', () => {
	const stale = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const online = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
	const state = {
		members: {
			[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
			ccc: { status: 'active', homeNodeHash: stale, memberKind: 'user' },
			ddd: { status: 'active', homeNodeHash: online, memberKind: 'user' },
		},
	}
	assertEquals(collectKnownPeerNodeHashes(state, self, [self, online]), [online])
})

Deno.test('collectKnownPeerNodeHashes ignores roster peers that are not active members', () => {
	const memberA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	const memberB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const extra = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
	const state = {
		members: {
			[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
			aaa: { status: 'active', homeNodeHash: memberA, memberKind: 'user' },
			bbb: { status: 'active', homeNodeHash: memberB, memberKind: 'user' },
		},
	}
	const known = collectKnownPeerNodeHashes(state, self, [self, memberA, memberB, extra])
	assertEquals([...known].sort(), [memberA, memberB].sort())
	const shuns = { [memberA]: now, [memberB]: now }
	const { suspected } = evaluateShunConsensusPure(known, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
	assertEquals(suspected, true)
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

Deno.test('resolveShunForPubKeyRequester: unknown unblocked key => no shun', () => {
	const unknownPk = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
	assertEquals(
		resolveShunForPubKeyRequester({ members: {}, bannedMembers: new Set() }, () => false, unknownPk),
		{ shun: false, reason: null },
	)
})

Deno.test('verifyPullAttestationSignatureForMember: missing member key fails without shun path', async () => {
	const unknownPk = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
	const fedState = { members: {}, bannedMembers: new Set() }
	assertEquals(resolveShunForPubKeyRequester(fedState, () => false, unknownPk), { shun: false, reason: null })
	assertEquals(await verifyPullAttestationSignatureForMember(fedState, 'g1', {
		requesterPubKeyHash: unknownPk,
		groupId: 'g1',
		requestId: 'req-missing-key',
		timestamp: Date.now(),
		wantIds: [],
		signature: '00',
	}), false)
})
