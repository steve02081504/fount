/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import { createOverlayRouter } from '../../overlay/index.mjs'

function identity(fill) {
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.alloc(32, fill))
	return {
		nodeHash: pubKeyHash(publicKey),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		secretKey,
	}
}

function createFakeNetwork(edges) {
	const registries = new Map()
	const listenersByNode = new Map()

	function neighborsOf(nodeHash) {
		return (edges.get(nodeHash) || []).map(target => ({ nodeHash: target }))
	}

	function makeRegistry(localIdentity) {
		const scopeListeners = new Map()
		const registry = {
			localIdentity,
			listLinks: () => neighborsOf(localIdentity.nodeHash),
			subscribeScope(prefix, handler) {
				if (!scopeListeners.has(prefix)) scopeListeners.set(prefix, new Set())
				scopeListeners.get(prefix).add(handler)
				return () => scopeListeners.get(prefix)?.delete(handler)
			},
			async sendToNodeLink(targetNodeHash, envelope) {
				const target = registries.get(targetNodeHash)
				if (!target) return false
				for (const [prefix, handlers] of listenersByNode.get(targetNodeHash).entries())
					if (String(envelope.scope || '').startsWith(prefix))
						for (const handler of handlers)
							handler(localIdentity.nodeHash, envelope, null)
				return true
			},
		}
		registries.set(localIdentity.nodeHash, registry)
		listenersByNode.set(localIdentity.nodeHash, scopeListeners)
		return registry
	}

	return { makeRegistry }
}

Deno.test('overlay router relays payload across a chain', async () => {
	const ids = [1, 2, 3, 4, 5].map(identity)
	const edges = new Map([
		[ids[0].nodeHash, [ids[1].nodeHash]],
		[ids[1].nodeHash, [ids[0].nodeHash, ids[2].nodeHash]],
		[ids[2].nodeHash, [ids[1].nodeHash, ids[3].nodeHash]],
		[ids[3].nodeHash, [ids[2].nodeHash, ids[4].nodeHash]],
		[ids[4].nodeHash, [ids[3].nodeHash]],
	])
	const network = createFakeNetwork(edges)
	const routers = ids.map(id => createOverlayRouter(network.makeRegistry(id)))
	const received = []
	const stop = routers[4].onRelay((body, meta) => received.push({ body, meta }))
	try {
		const path = ids.map(id => id.nodeHash)
		await routers[0].relay(path, { ok: true })
		await new Promise(resolve => setTimeout(resolve, 50))
		assertEquals(received.length, 1)
		assertEquals(received[0].body.ok, true)
	}
	finally {
		stop()
		for (const router of routers) router.close()
	}
})

Deno.test('overlay router rejects forged route responses', async () => {
	const ids = [7, 8].map(identity)
	const edges = new Map([
		[ids[0].nodeHash, [ids[1].nodeHash]],
		[ids[1].nodeHash, [ids[0].nodeHash]],
	])
	const network = createFakeNetwork(edges)
	const left = createOverlayRouter(network.makeRegistry(ids[0]))
	const rightRegistry = network.makeRegistry(ids[1])
	try {
		const routePromise = left.discoverRoute(ids[1].nodeHash, { timeoutMs: 50 })
		await rightRegistry.sendToNodeLink(ids[0].nodeHash, {
			scope: 'overlay',
			action: 'route_resp',
			payload: {
				action: 'route_resp',
				reqId: 'bad',
				path: [ids[0].nodeHash, ids[1].nodeHash],
				nodePubKey: ids[1].nodePubKey,
				sig: '00'.repeat(64),
			},
		})
		await assertRejects(async () => await routePromise)
	}
	finally {
		left.close()
	}
})
