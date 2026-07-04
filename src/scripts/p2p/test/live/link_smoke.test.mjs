/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { DEFAULT_ICE_SERVERS } from '../../ice_servers.mjs'
import { createLink } from '../../link/link.mjs'
import { createSignalPair, identity } from './helpers.mjs'

Deno.test({
	name: 'link smoke completes handshake and identifies remote node',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const alice = identity(1)
		const bob = identity(2)
		const signals = createSignalPair()
		const aliceLink = await createLink({
			nodeHash: bob.nodeHash,
			initiator: true,
			signal: signals.left,
			iceServers: DEFAULT_ICE_SERVERS,
			localIdentity: alice,
		})
		const bobLink = await createLink({
			nodeHash: alice.nodeHash,
			initiator: false,
			signal: signals.right,
			iceServers: DEFAULT_ICE_SERVERS,
			localIdentity: bob,
		})
		try {
			await Promise.all([aliceLink.ready, bobLink.ready])
			assertEquals(aliceLink.nodeHash, bob.nodeHash)
			assertEquals(bobLink.nodeHash, alice.nodeHash)
		}
		finally {
			await aliceLink.close('test-done')
			await bobLink.close('test-done')
		}
	},
})
