/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	EXPLORE_MAX_PER_SOURCE,
	mergeTrustedWithAnchors,
	resolveFederationPoolLimits,
	selectExploreWithSourceQuota,
} from '../peer_pool.mjs'

const A = `${'a'.repeat(64)}`
const B = `${'b'.repeat(64)}`
const C = `${'c'.repeat(64)}`
const D = `${'d'.repeat(64)}`
const E = `${'e'.repeat(64)}`
const limits = resolveFederationPoolLimits({ trustedPeerSlots: 3, explorePeerSlots: 4 })

Deno.test('mergeTrustedWithAnchors keeps low-rep anchors first', () => {
	const rep = { byNodeHash: { [A]: { score: 0.9 }, [B]: { score: 0.1 }, [C]: { score: 0.8 } } }
	const ranked = [A, C, B]
	const trusted = mergeTrustedWithAnchors([B], ranked, limits)
	assertEquals(trusted[0], B)
	assertEquals(trusted.includes(A), true)
})

Deno.test('selectExploreWithSourceQuota caps single source', () => {
	const sources = new Map([
		[A, 'attacker'],
		[B, 'attacker'],
		[C, 'attacker'],
		[D, 'honest'],
		[E, 'honest'],
	])
	const picked = selectExploreWithSourceQuota([A, B, C, D, E], sources, 4, EXPLORE_MAX_PER_SOURCE)
	const bySrc = new Map()
	for (const id of picked) {
		const src = sources.get(id)
		bySrc.set(src, (bySrc.get(src) ?? 0) + 1)
	}
	assertEquals((bySrc.get('attacker') ?? 0) <= EXPLORE_MAX_PER_SOURCE, true)
	assertEquals(picked.length, 4)
})
