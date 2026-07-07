/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveFederationPoolLimits, selectLinkTargetsFromMembers } from '../../peer_pool.mjs'

const SELF = 's'.repeat(64)
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const BLOCKED = 'e'.repeat(64)
const QUAR = 'f'.repeat(64)
const ANCHOR1 = '1'.repeat(64)
const ANCHOR2 = '2'.repeat(64)

const emptyPeers = { trustedPeers: [], explorePeers: [], blockedPeers: [] }

Deno.test('selectLinkTargetsFromMembers: top-K trusted + explore, filters self/blocked/quarantine', () => {
	const limits = resolveFederationPoolLimits({ trustedPeerSlots: 2, explorePeerSlots: 2 })
	const rep = {
		byNodeHash: {
			[A]: { score: 0.9 },
			[B]: { score: 0.5 },
			[C]: { score: 0.1 },
			[QUAR]: { score: 0.99, quarantinedUntil: Date.now() + 1_000_000 },
		},
	}
	const targets = new Set(selectLinkTargetsFromMembers({
		members: [SELF, A, B, C, BLOCKED, QUAR],
		selfNodeHash: SELF,
		rep,
		peers: { trustedPeers: [], explorePeers: [], blockedPeers: [BLOCKED] },
		limits,
	}))
	assertEquals(targets.has(A), true)
	assertEquals(targets.has(B), true)
	assertEquals(targets.has(C), true)
	assertEquals(targets.has(SELF), false)
	assertEquals(targets.has(BLOCKED), false)
	assertEquals(targets.has(QUAR), false)
})

Deno.test('selectLinkTargetsFromMembers: anchors always connected even beyond trusted budget', () => {
	const limits = resolveFederationPoolLimits({ trustedPeerSlots: 1 })
	const rep = { byNodeHash: { [A]: { score: 0.9 } } }
	const targets = new Set(selectLinkTargetsFromMembers({
		members: [ANCHOR1, ANCHOR2, A],
		selfNodeHash: SELF,
		rep,
		peers: emptyPeers,
		limits,
		anchors: [ANCHOR1, ANCHOR2],
	}))
	// trustedSlots=1 只能容一个锚点，但两个锚点都必须入选（forced 在 merge 裁剪后被重新补回，保证引导期必连）。
	assertEquals(limits.trustedSlots, 1)
	assertEquals(targets.has(ANCHOR1), true)
	assertEquals(targets.has(ANCHOR2), true)
})

Deno.test('selectLinkTargetsFromMembers: explore fills remaining members when slots ample', () => {
	const limits = resolveFederationPoolLimits({ trustedPeerSlots: 1, explorePeerSlots: 5 })
	const rep = { byNodeHash: { [A]: { score: 0.9 }, [B]: { score: 0.2 }, [C]: { score: 0.1 } } }
	const targets = new Set(selectLinkTargetsFromMembers({
		members: [A, B, C],
		selfNodeHash: SELF,
		rep,
		peers: emptyPeers,
		limits,
	}))
	assertEquals(targets.has(A), true)
	assertEquals(targets.has(B), true)
	assertEquals(targets.has(C), true)
})

Deno.test('selectLinkTargetsFromMembers: empty members yields nothing', () => {
	const limits = resolveFederationPoolLimits({})
	assertEquals(
		selectLinkTargetsFromMembers({ members: [], selfNodeHash: SELF, rep: {}, peers: emptyPeers, limits }).length,
		0,
	)
})
