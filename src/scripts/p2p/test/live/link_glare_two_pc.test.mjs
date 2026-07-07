/* global Deno */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { registerDiscoveryProvider } from '../../discovery/index.mjs'
import { compareHex64Asc } from '../../hexIds.mjs'
import { createLinkRegistry } from '../../link_registry.mjs'

import { identity, waitFor } from './helpers.mjs'

/**
 * 创建共享内存 mock discovery provider（advert/signal 均按 topic 广播）。
 * @returns {import('../../discovery/index.mjs').DiscoveryProvider} mock 发现提供者
 */
function createMockDiscoveryProvider() {
	/** @type {Map<string, Set<Function>>} */
	const advertListeners = new Map()
	/** @type {Map<string, Set<Function>>} */
	const signalListeners = new Map()
	/** @type {Map<string, Uint8Array>} */
	const lastAdvert = new Map()
	return {
		id: 'mock-glare-two-pc-discovery',
		priority: 1,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		/**
		 * 广播 advert 并回放给已有订阅者。
		 * @param {string} topic advert topic
		 * @param {Uint8Array} bytes advert 载荷
		 * @returns {() => void} 空取消函数
		 */
		advertise(topic, bytes) {
			lastAdvert.set(topic, bytes)
			for (const listener of advertListeners.get(topic) || [])
				listener(bytes, { provider: 'mock' })
			return () => {}
		},
		/**
		 * 订阅 advert 并回放最近一次广播。
		 * @param {string} topic advert topic
		 * @param {Function} onAdvert advert 回调
		 * @returns {() => void} 取消订阅函数
		 */
		subscribe(topic, onAdvert) {
			if (!advertListeners.has(topic)) advertListeners.set(topic, new Set())
			advertListeners.get(topic).add(onAdvert)
			if (lastAdvert.has(topic)) onAdvert(lastAdvert.get(topic), { provider: 'mock' })
			return () => advertListeners.get(topic)?.delete(onAdvert)
		},
		/**
		 * 向 topic 订阅者投递信令。
		 * @param {string} topic 信令 topic
		 * @param {string} _to 目标标识（未使用）
		 * @param {Uint8Array} bytes 信令载荷
		 * @returns {void}
		 */
		sendSignal(topic, _to, bytes) {
			for (const listener of signalListeners.get(topic) || [])
				queueMicrotask(() => listener(bytes, { provider: 'mock' }))
		},
		/**
		 * 订阅信令。
		 * @param {string} topic 信令 topic
		 * @param {Function} onSignal 信令回调
		 * @returns {() => void} 取消订阅函数
		 */
		onSignal(topic, onSignal) {
			if (!signalListeners.has(topic)) signalListeners.set(topic, new Set())
			signalListeners.get(topic).add(onSignal)
			return () => signalListeners.get(topic)?.delete(onSignal)
		},
	}
}

/**
 * 单轮双向同时建链：两侧几乎必然 glare（各建 initiator + responder 两条 PC），
 * 断言最终两端各收敛出恰好一条、且都是"由较小 nodeHash 发起"的那条（确定性择一，两端一致）。
 * @returns {Promise<void>}
 */
async function runGlareRound() {
	const unregister = registerDiscoveryProvider(createMockDiscoveryProvider())
	const alice = identity(41)
	const bob = identity(42)
	const aliceRegistry = createLinkRegistry({ localIdentity: alice, autoRegisterDiscoveryProviders: false })
	const bobRegistry = createLinkRegistry({ localIdentity: bob, autoRegisterDiscoveryProviders: false })
	// 较小 nodeHash 发起的那条被保留：较小方持有 initiator=true，较大方持有 initiator=false。
	const aliceIsSmaller = compareHex64Asc(alice.nodeHash, bob.nodeHash) < 0
	try {
		await Promise.all([aliceRegistry.ensureRuntime(), bobRegistry.ensureRuntime()])
		// 双向同时发起——glare 场景：各自建 initiator PC 且收到对端 offer 建 responder PC。
		await Promise.all([
			aliceRegistry.ensureLinkToNode(bob.nodeHash),
			bobRegistry.ensureLinkToNode(alice.nodeHash),
		])
		// 等到两端稳定收敛到"较小方发起"的规范链，证明双 PC 已择一（败者已被静默关闭）。
		await waitFor(
			() => {
				const al = aliceRegistry.getLink(bob.nodeHash)
				const bl = bobRegistry.getLink(alice.nodeHash)
				return !!al && !!bl
					&& al.initiator === aliceIsSmaller
					&& bl.initiator === !aliceIsSmaller
			},
			30_000,
		)
		const aliceLink = aliceRegistry.getLink(bob.nodeHash)
		const bobLink = bobRegistry.getLink(alice.nodeHash)
		assertEquals(aliceLink.nodeHash, bob.nodeHash)
		assertEquals(bobLink.nodeHash, alice.nodeHash)
		assertEquals(aliceLink.initiator, aliceIsSmaller)
		assertEquals(bobLink.initiator, !aliceIsSmaller)
		// 双向可用：规范链两端都能发帧（择一保留的是同一条逻辑连接）。
		assertEquals(await aliceLink.send({ scope: 'test', action: 'ping', payload: 1 }), true)
		assertEquals(await bobLink.send({ scope: 'test', action: 'ping', payload: 1 }), true)
	}
	finally {
		await aliceRegistry.shutdown()
		await bobRegistry.shutdown()
		unregister()
	}
}

Deno.test({
	name: 'link registry: simultaneous dial builds two PCs then deterministically keeps one',
	sanitizeOps: false,
	sanitizeResources: false,
	/**
	 * 连续多轮双向同时建链，全部确定性收敛到"较小方发起"的单条链，证明双 PC 择一稳定。
	 * @returns {Promise<void>}
	 */
	async fn() {
		for (let round = 0; round < 8; round++)
			await runGlareRound()
	},
})
