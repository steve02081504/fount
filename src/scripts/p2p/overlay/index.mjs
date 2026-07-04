import { Buffer } from 'node:buffer'

import { createLruMap } from '../../memo.mjs'
import { keyPairFromSeed, pubKeyHash, sign, verify } from '../crypto.mjs'
import { randomMsgIdHex } from '../link/frame.mjs'

const ROUTE_DOMAIN = 'fount-route-v1'

/**
 * @param {string} reqId
 * @param {string[]} path
 * @returns {Uint8Array}
 */
function routeSignBytes(reqId, path) {
	return Buffer.from(`${ROUTE_DOMAIN}\0${reqId}\0${path.join(',')}`, 'utf8')
}

/**
 * @param {object} registry
 * @param {number} [ttl=3]
 * @returns {object}
 */
export function createOverlayRouter(registry, ttl = 3) {
	const selfNodeHash = registry.localIdentity.nodeHash
	const selfPubKey = registry.localIdentity.nodePubKey
	const secretKey = registry.localIdentity.secretKey
	const seenReqs = createLruMap(4096)
	/** @type {Map<string, { resolve: (path: string[]) => void, reject: (err: Error) => void, timer: number }>} */
	const pendingRoutes = new Map()
	/** @type {Set<(body: unknown, meta: { path: string[], from: string }) => void>} */
	const relayListeners = new Set()

	/**
	 * @param {string} nodeHash
	 * @param {object} payload
	 * @returns {Promise<void>}
	 */
	async function sendOverlay(nodeHash, payload) {
		await registry.sendToNodeLink(nodeHash, { scope: 'overlay', action: payload.action, payload })
	}

	/**
	 * @param {string} senderNodeHash
	 * @param {object} envelope
	 * @returns {Promise<void>}
	 */
	async function handleOverlay(senderNodeHash, envelope) {
		const payload = envelope?.payload
		const action = String(envelope?.action || '')
		if (!payload || typeof payload !== 'object') return
		if (action === 'route_req') {
			const reqId = String(payload.reqId || '')
			const target = String(payload.target || '')
			const hops = Array.isArray(payload.path) ? payload.path.map(String) : []
			const remainingTtl = Number(payload.ttl)
			if (!reqId || !target || !hops.length || remainingTtl <= 0) return
			if (seenReqs.has(reqId) || hops.includes(selfNodeHash) || hops.length > 6) return
			seenReqs.touch(reqId, true)
			const nextPath = [...hops, selfNodeHash]
			if (target === selfNodeHash) {
				const sig = await sign(routeSignBytes(reqId, nextPath), secretKey)
				const prevHop = hops[hops.length - 1]
				if (prevHop)
					await sendOverlay(prevHop, {
						action: 'route_resp',
						reqId,
						path: nextPath,
						nodePubKey: selfPubKey,
						sig: Buffer.from(sig).toString('hex'),
					})
				return
			}
			for (const { nodeHash } of registry.listLinks())
				if (nodeHash !== senderNodeHash && !hops.includes(nodeHash))
					await sendOverlay(nodeHash, {
						action: 'route_req',
						reqId,
						target,
						ttl: remainingTtl - 1,
						path: nextPath,
					})
			return
		}
		if (action === 'route_resp') {
			const reqId = String(payload.reqId || '')
			const path = Array.isArray(payload.path) ? payload.path.map(String) : []
			const nodePubKey = String(payload.nodePubKey || '')
			const sigHex = String(payload.sig || '')
			if (!reqId || path.length < 2 || !nodePubKey || !sigHex) return
			if (pubKeyHash(Buffer.from(nodePubKey, 'hex')) !== path[path.length - 1]) return
			const ok = await verify(Buffer.from(sigHex, 'hex'), routeSignBytes(reqId, path), Buffer.from(nodePubKey, 'hex'))
			if (!ok) return
			if (path[0] === selfNodeHash) {
				const pending = pendingRoutes.get(reqId)
				if (!pending) return
				clearTimeout(pending.timer)
				pendingRoutes.delete(reqId)
				pending.resolve(path)
				return
			}
			const index = path.indexOf(selfNodeHash)
			if (index <= 0) return
			await sendOverlay(path[index - 1], payload)
			return
		}
		if (action === 'relay') {
			const path = Array.isArray(payload.path) ? payload.path.map(String) : []
			const index = Number(payload.idx)
			if (!path.length || path[index] !== selfNodeHash) return
			if (index === path.length - 1) {
				for (const listener of relayListeners)
					listener(payload.body, { path, from: senderNodeHash })
				return
			}
			await sendOverlay(path[index + 1], {
				action: 'relay',
				path,
				idx: index + 1,
				body: payload.body,
			})
		}
	}

	const unsubscribe = registry.subscribeScope('overlay', handleOverlay)

	return {
		async discoverRoute(targetNodeHash, opts = {}) {
			const reqId = randomMsgIdHex()
			const maxTtl = Number(opts.ttl) || ttl
			const timeoutMs = Number(opts.timeoutMs) || 10_000
			const promise = new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pendingRoutes.delete(reqId)
					reject(new Error(`overlay: route discovery timeout for ${targetNodeHash}`))
				}, timeoutMs)
				pendingRoutes.set(reqId, { resolve, reject, timer })
			})
			for (const { nodeHash } of registry.listLinks())
				await sendOverlay(nodeHash, {
					action: 'route_req',
					reqId,
					target: targetNodeHash,
					ttl: maxTtl,
					path: [selfNodeHash],
				})
			return await promise
		},
		async relay(path, body) {
			if (!Array.isArray(path) || path[0] !== selfNodeHash || path.length < 2)
				throw new Error('overlay: invalid relay path')
			await sendOverlay(path[1], { action: 'relay', path, idx: 1, body })
		},
		onRelay(listener) {
			relayListeners.add(listener)
			return () => relayListeners.delete(listener)
		},
		close() {
			unsubscribe()
			for (const pending of pendingRoutes.values()) clearTimeout(pending.timer)
			pendingRoutes.clear()
			relayListeners.clear()
		},
	}
}
