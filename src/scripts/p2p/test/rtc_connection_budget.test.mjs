/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	annotateRtcPeerNodeHash,
	releaseRtcPeer,
	takeRtcJoinSlot,
} from '../rtc_connection_budget.mjs'

const LIMITS = { maxActive: 8, maxJoinsPerMin: 120, trustedPeers: ['trusted-node'] }

Deno.test('single source cannot fill all rtc slots', () => {
	const room = 'room-source-cap'
	const sourceCap = Math.max(1, Math.floor(LIMITS.maxActive * 0.35))
	for (let i = 0; i < sourceCap; i++)
		assertEquals(takeRtcJoinSlot(room, `p${i}`, LIMITS, 'sybil-source'), true)
	assertEquals(takeRtcJoinSlot(room, 'p-extra', LIMITS, 'sybil-source'), false)
	for (let i = 0; i < sourceCap; i++) releaseRtcPeer(room, `p${i}`)
})

Deno.test('trusted peer annotated after identity keeps slot under load', () => {
	const room = 'room-trusted'
	const trustedPeer = 'peer-trusted'
	for (let i = 0; i < 7; i++)
		takeRtcJoinSlot(room, `fill${i}`, LIMITS, `src${i}`)
	takeRtcJoinSlot(room, trustedPeer, LIMITS, 'sybil-source')
	annotateRtcPeerNodeHash(room, trustedPeer, 'trusted-node', LIMITS)
	assertEquals(takeRtcJoinSlot(room, trustedPeer, LIMITS, 'sybil-source'), true)
	releaseRtcPeer(room, trustedPeer)
})
