/* global Deno */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { registerDiscoveryProvider } from '../../discovery/index.mjs'
import { createLinkRegistry } from '../../link_registry.mjs'
import { identity, waitFor } from './helpers.mjs'

function createMockDiscoveryProvider() {
	/** @type {Map<string, Set<Function>>} */
	const advertListeners = new Map()
	/** @type {Map<string, Set<Function>>} */
	const signalListeners = new Map()
	/** @type {Map<string, Uint8Array>} */
	const lastAdvert = new Map()
	return {
		id: 'mock-discovery',
		priority: 1,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		advertise(topic, bytes) {
			lastAdvert.set(topic, bytes)
			for (const listener of advertListeners.get(topic) || [])
				listener(bytes, { provider: 'mock' })
			return () => {}
		},
		subscribe(topic, onAdvert) {
			if (!advertListeners.has(topic)) advertListeners.set(topic, new Set())
			advertListeners.get(topic).add(onAdvert)
			if (lastAdvert.has(topic)) onAdvert(lastAdvert.get(topic), { provider: 'mock' })
			return () => advertListeners.get(topic)?.delete(onAdvert)
		},
		sendSignal(topic, _to, bytes) {
			for (const listener of signalListeners.get(topic) || [])
				queueMicrotask(() => listener(bytes, { provider: 'mock' }))
		},
		onSignal(topic, onSignal) {
			if (!signalListeners.has(topic)) signalListeners.set(topic, new Set())
			signalListeners.get(topic).add(onSignal)
			return () => signalListeners.get(topic)?.delete(onSignal)
		},
	}
}

Deno.test({
	name: 'link registry uses discovery bus for adverts and nodeHash dialing',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const unregister = registerDiscoveryProvider(createMockDiscoveryProvider())
		const alice = identity(11)
		const bob = identity(12)
		const aliceRegistry = createLinkRegistry({ localIdentity: alice, autoRegisterDiscoveryProviders: false })
		const bobRegistry = createLinkRegistry({ localIdentity: bob, autoRegisterDiscoveryProviders: false })
		const adverts = []
		const received = []
		const stopAdvert = await aliceRegistry.subscribeNodeAdvert(bob.nodeHash, nodeHash => adverts.push(nodeHash))
		const stopNode = bobRegistry.subscribeScope('node', (senderNodeHash, envelope) => {
			received.push({ senderNodeHash, envelope })
		})
		try {
			await Promise.all([aliceRegistry.ensureRuntime(), bobRegistry.ensureRuntime()])
			await waitFor(() => adverts.includes(bob.nodeHash), 5_000)
			await aliceRegistry.ensureLinkToNode(bob.nodeHash)
			await aliceRegistry.sendToNodeLink(bob.nodeHash, {
				scope: 'node',
				action: 'mailbox_put',
				payload: { ok: true },
			})
			await waitFor(() => received.length > 0, 10_000)
			assertEquals(received[0].senderNodeHash, alice.nodeHash)
			assertEquals(received[0].envelope.action, 'mailbox_put')
			assertEquals(received[0].envelope.payload.ok, true)
		}
		finally {
			stopAdvert()
			stopNode()
			await aliceRegistry.shutdown()
			await bobRegistry.shutdown()
			unregister()
		}
	},
})
