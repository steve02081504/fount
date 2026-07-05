/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import { createOverlayRouter } from '../../overlay/index.mjs'

/**
 * 从固定 seed 生成测试身份。
 * @param {number} fill seed 填充字节值
 * @returns {{ nodeHash: string, nodePubKey: string, secretKey: Uint8Array }} 节点身份
 */
function identity(fill) {
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.alloc(32, fill))
	return {
		nodeHash: pubKeyHash(publicKey),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		secretKey,
	}
}

/**
 * 创建 fake overlay 网络（内存 registry + 邻接表）。
 * @param {Map<string, string[]>} edges 节点 → 邻居 nodeHash 列表
 * @returns {{ makeRegistry: (localIdentity: { nodeHash: string, nodePubKey: string, secretKey: Uint8Array }) => object }} 网络工厂
 */
function createFakeNetwork(edges) {
	const registries = new Map()
	const listenersByNode = new Map()

	/**
	 * 查询节点的邻居列表。
	 * @param {string} nodeHash 节点 hash
	 * @returns {Array<{ nodeHash: string }>} 邻居描述
	 */
	function neighborsOf(nodeHash) {
		return (edges.get(nodeHash) || []).map(target => ({ nodeHash: target }))
	}

	/**
	 * 为本地身份创建 fake link registry。
	 * @param {{ nodeHash: string, nodePubKey: string, secretKey: Uint8Array }} localIdentity 本地身份
	 * @returns {object} fake registry 对象
	 */
	function makeRegistry(localIdentity) {
		const scopeListeners = new Map()
		const registry = {
			localIdentity,
			/**
			 * 列出当前节点的链路邻居。
			 * @returns {Array<{ nodeHash: string }>} 邻居列表
			 */
			listLinks: () => neighborsOf(localIdentity.nodeHash),
			/**
			 * 按 scope 前缀订阅 envelope。
			 * @param {string} prefix scope 前缀
			 * @param {Function} handler envelope 处理器
			 * @returns {() => void} 取消订阅函数
			 */
			subscribeScope(prefix, handler) {
				if (!scopeListeners.has(prefix)) scopeListeners.set(prefix, new Set())
				scopeListeners.get(prefix).add(handler)
				return () => scopeListeners.get(prefix)?.delete(handler)
			},
			/**
			 * 向目标节点投递 envelope。
			 * @param {string} targetNodeHash 目标节点 hash
			 * @param {object} envelope 待投递 envelope
			 * @returns {Promise<boolean>} 是否投递成功
			 */
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
