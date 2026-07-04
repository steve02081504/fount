/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import { registerDiscoveryProvider } from '../../discovery/index.mjs'
import { createGroupLinkSet } from '../../group_link_set.mjs'
import { createLinkRegistry } from '../../link_registry.mjs'

function identity(fill) {
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.alloc(32, fill))
	return {
		nodeHash: pubKeyHash(publicKey),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		secretKey,
	}
}

function createMockDiscoveryProvider() {
	const advertListeners = new Map()
	const signalListeners = new Map()
	const lastAdvert = new Map()
	return {
		id: 'mock-group-discovery',
		priority: 1,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		advertise(topic, bytes) {
			lastAdvert.set(topic, bytes)
			for (const listener of advertListeners.get(topic) || [])
				listener(bytes)
			return () => {}
		},
		subscribe(topic, onAdvert) {
			if (!advertListeners.has(topic)) advertListeners.set(topic, new Set())
			advertListeners.get(topic).add(onAdvert)
			if (lastAdvert.has(topic)) onAdvert(lastAdvert.get(topic))
			return () => advertListeners.get(topic)?.delete(onAdvert)
		},
		sendSignal(topic, _to, bytes) {
			for (const listener of signalListeners.get(topic) || [])
				queueMicrotask(() => listener(bytes))
		},
		onSignal(topic, onSignal) {
			if (!signalListeners.has(topic)) signalListeners.set(topic, new Set())
			signalListeners.get(topic).add(onSignal)
			return () => signalListeners.get(topic)?.delete(onSignal)
		},
	}
}

async function waitFor(predicate, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return
		await new Promise(resolve => setTimeout(resolve, 50))
	}
	throw new Error(`waitFor timeout after ${timeoutMs}ms`)
}

Deno.test({
	name: 'group link set advertises shared topic and carries group envelopes',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const unregister = registerDiscoveryProvider(createMockDiscoveryProvider())
		const alice = identity(21)
		const bob = identity(22)
		const roomSecret = 'shared-room-secret'
		const members = [alice.nodeHash, bob.nodeHash]
		const aliceRegistry = createLinkRegistry({ localIdentity: alice })
		const bobRegistry = createLinkRegistry({ localIdentity: bob })
		const aliceGroup = createGroupLinkSet({ groupId: 'g1', roomSecret, members, registry: aliceRegistry, autoconnect: false })
		const bobGroup = createGroupLinkSet({ groupId: 'g1', roomSecret, members, registry: bobRegistry, autoconnect: false })
		const received = []
		const off = bobGroup.onEnvelope((senderNodeHash, envelope) => {
			received.push({ senderNodeHash, envelope })
		})
		try {
			await Promise.all([aliceRegistry.ensureRuntime(), bobRegistry.ensureRuntime()])
			await bobGroup.start()
			await aliceRegistry.ensureLinkToNode(bob.nodeHash)
			await waitFor(() => !!aliceRegistry.getLink(bob.nodeHash), 10_000)
			await aliceGroup.send('dag_event', { hello: 'group' })
			await waitFor(() => received.length > 0, 10_000)
			assertEquals(received[0].senderNodeHash, alice.nodeHash)
			assertEquals(received[0].envelope.scope, 'group:g1')
			assertEquals(received[0].envelope.action, 'dag_event')
			assertEquals(received[0].envelope.payload.hello, 'group')
		}
		finally {
			off()
			await aliceGroup.leave()
			await bobGroup.leave()
			await aliceRegistry.shutdown()
			await bobRegistry.shutdown()
			unregister()
		}
	},
})
