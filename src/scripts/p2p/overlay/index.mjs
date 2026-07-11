import { Buffer } from 'node:buffer'

import { createLruMap } from '../utils/lru.mjs'
import { pubKeyHash, sign, verify } from '../crypto.mjs'
import { randomMsgIdHex } from '../link/frame.mjs'

const ROUTE_DOMAIN = 'fount-route-v1'

/**
 * 构造 overlay 路由签名用的字节序列。
 * @param {string} reqId 路由请求 id
 * @param {string[]} path 已遍历节点路径
 * @returns {Uint8Array} 待签名字节
 */
function routeSignBytes(reqId, path) {
	return Buffer.from(`${ROUTE_DOMAIN}\0${reqId}\0${path.join(',')}`, 'utf8')
}

/**
 * 创建 overlay 多跳路由与 relay 路由器。
 * @param {object} registry link registry（含 localIdentity、sendToNodeLink、listLinks、subscribeScope）
 * @param {number} [ttl=3] 默认路由 TTL（最大跳数）
 * @returns {object} 路由器接口（discoverRoute、relay、onRelay、close）
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
	 * 经 overlay scope 向节点发送 payload。
	 * @param {string} nodeHash 目标节点 64 hex
	 * @param {object} payload overlay action 载荷
	 * @returns {Promise<void>}
	 */
	async function sendOverlay(nodeHash, payload) {
		await registry.sendToNodeLink(nodeHash, { scope: 'overlay', action: payload.action, payload })
	}

	/**
	 * 处理入站 overlay envelope（route_req / route_resp / relay）。
	 * @param {string} senderNodeHash 发送方节点 64 hex
	 * @param {object} envelope overlay envelope
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
		/**
		 * 发现到目标节点的签名路由路径。
		 * @param {string} targetNodeHash 目标节点 64 hex
		 * @param {object} [opts] 选项
		 * @param {number} [opts.ttl] 路由 TTL
		 * @param {number} [opts.timeoutMs] 超时毫秒
		 * @returns {Promise<string[]>} 从本节点到目标的 nodeHash 路径
		 */
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
		/**
		 * 沿已发现路径 relay 载荷到路径末端。
		 * @param {string[]} path 路由路径（首节点须为本节点）
		 * @param {unknown} body relay 载荷
		 * @returns {Promise<void>}
		 */
		async relay(path, body) {
			if (!Array.isArray(path) || path[0] !== selfNodeHash || path.length < 2)
				throw new Error('overlay: invalid relay path')
			await sendOverlay(path[1], { action: 'relay', path, idx: 1, body })
		},
		/**
		 * 订阅 relay 到达本节点（路径末端）的载荷。
		 * @param {(body: unknown, meta: { path: string[], from: string }) => void} listener 回调
		 * @returns {() => void} 取消订阅函数
		 */
		onRelay(listener) {
			relayListeners.add(listener)
			return () => relayListeners.delete(listener)
		},
		/**
		 * 关闭路由器并清理 pending 与监听器。
		 * @returns {void}
		 */
		close() {
			unsubscribe()
			for (const pending of pendingRoutes.values()) clearTimeout(pending.timer)
			pendingRoutes.clear()
			relayListeners.clear()
		},
	}
}
