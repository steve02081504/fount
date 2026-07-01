import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	collectKnownPeerNodeHashes,
	evaluateShunConsensusPure,
	resolveShunForNodeHashRequester,
} from '../../src/chat/federation/shun.mjs'
import { SHUN_CONSENSUS_WINDOW_MS } from '../../src/group/groupShunState.mjs'

describe('evaluateShunConsensusPure', () => {
	const peers = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
	const self = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
	const now = 1_000_000

	it('all known peers shunned within window => suspected', () => {
		const shuns = {
			[peers[0]]: now - 1000,
			[peers[1]]: now - 2000,
		}
		const { suspected, shunnedBy } = evaluateShunConsensusPure(peers, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
		assert.equal(suspected, true)
		assert.equal(shunnedBy.length, 2)
	})

	it('missing one peer shun => not suspected', () => {
		const shuns = { [peers[0]]: now - 1000 }
		const { suspected } = evaluateShunConsensusPure(peers, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
		assert.equal(suspected, false)
	})

	it('expired shun outside window => not suspected', () => {
		const shuns = {
			[peers[0]]: now - SHUN_CONSENSUS_WINDOW_MS - 1,
			[peers[1]]: now - 1000,
		}
		const { suspected } = evaluateShunConsensusPure(peers, shuns, now, SHUN_CONSENSUS_WINDOW_MS)
		assert.equal(suspected, false)
	})

	it('single peer group: one shun => suspected', () => {
		const single = [peers[0]]
		const { suspected } = evaluateShunConsensusPure(single, { [peers[0]]: now }, now, SHUN_CONSENSUS_WINDOW_MS)
		assert.equal(suspected, true)
	})

	it('no known peers => not suspected', () => {
		const { suspected } = evaluateShunConsensusPure([], { [peers[0]]: now }, now, SHUN_CONSENSUS_WINDOW_MS)
		assert.equal(suspected, false)
	})
})

describe('collectKnownPeerNodeHashes', () => {
	it('collects active member home nodes excluding self', () => {
		const self = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
		const state = {
			members: {
				[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
				ccc: { status: 'active', homeNodeHash: other, memberKind: 'user' },
				ddd: { status: 'banned', homeNodeHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', memberKind: 'user' },
			},
		}
		const nodes = collectKnownPeerNodeHashes(state, self)
		assert.deepEqual(nodes, [other])
	})

	it('prefers roster peers over stale member home nodes', () => {
		const self = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		const stale = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
		const online = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
		const state = {
			members: {
				[self]: { status: 'active', homeNodeHash: self, memberKind: 'user' },
				ccc: { status: 'active', homeNodeHash: stale, memberKind: 'user' },
				ddd: { status: 'active', homeNodeHash: online, memberKind: 'user' },
			},
		}
		const nodes = collectKnownPeerNodeHashes(state, self, [self, online])
		assert.deepEqual(nodes, [online])
	})
})

describe('resolveShunForNodeHashRequester', () => {
	const nodeA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	const nodeB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const pkB = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

	it('active member home node => no shun', () => {
		const state = {
			members: {
				[pkB]: { status: 'active', homeNodeHash: nodeB, memberKind: 'user' },
			},
		}
		assert.deepEqual(resolveShunForNodeHashRequester(state, () => false, nodeB), { shun: false, reason: null })
	})

	it('banned member home node => shun not_a_member', () => {
		const state = {
			members: {
				[pkB]: { status: 'banned', homeNodeHash: nodeB, memberKind: 'user' },
			},
		}
		assert.deepEqual(resolveShunForNodeHashRequester(state, () => false, nodeB), { shun: true, reason: 'not_a_member' })
	})

	it('bannedNodes set => shun not_a_member', () => {
		const state = { members: {}, bannedNodes: new Set([nodeB]) }
		assert.deepEqual(resolveShunForNodeHashRequester(state, () => false, nodeB), { shun: true, reason: 'not_a_member' })
	})

	it('unknown node => no shun', () => {
		assert.deepEqual(resolveShunForNodeHashRequester({ members: {} }, () => false, nodeA), { shun: false, reason: null })
	})
})
