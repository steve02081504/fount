/**
 * 服务器可达性探测测试：预算由实测时延推导、grace 等待、复核次数。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	firstPositive,
	probeServerReachability,
	WAKE_PROBE_GRACE_RATIO,
	WAKE_PROBE_MIN_BUDGET_MS,
	WAKE_PROBE_RTT_FACTOR,
} from '../../scripts/lib/serverReachability.mjs'

/**
 * 构造可控的探测环境。
 * @param {number[]} durationsMs - 每次 `/api/ping` 的模拟耗时。
 * @param {boolean[]} outcomes - 每次调用的成败。
 * @param {{ abortable?: boolean }} [options] - `abortable` 为真时模拟请求会被 `init.signal` 中止。
 * @returns {{ fetches: number, sleeps: number[], options: object }} 观测到的调用记录
 */
function createHarness(durationsMs, outcomes, { abortable = false } = {}) {
	const calls = { fetches: 0, sleeps: [], options: {} }
	let clock = 0
	calls.options = {
		/**
		 * 伪造的 ping 请求。
		 * @param {string} _url - 请求地址
		 * @param {{ signal?: AbortSignal }} [init] - 请求参数
		 * @returns {Promise<{ ok: boolean }>} 模拟响应
		 */
		fetchImpl: async (_url, init) => {
			const index = calls.fetches++
			if (abortable) return await new Promise((resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
				setTimeout(() => {
					clock += durationsMs[index] ?? 0
					if (outcomes[index] === false) reject(new Error('network down'))
					else resolve({ ok: true })
				}, 1)
			})
			clock += durationsMs[index] ?? 0
			if (outcomes[index] === false) throw new Error('network down')
			return { ok: outcomes[index] !== false }
		},
		/**
		 * 伪造的等待。
		 * @param {number} milliseconds - 等待时长
		 * @returns {Promise<void>} 无返回值
		 */
		sleep: async milliseconds => { calls.sleeps.push(milliseconds); clock += milliseconds },
		/**
		 * 受控时钟。
		 * @returns {number} 当前时间
		 */
		now: () => clock,
	}
	return calls
}

Deno.test('probeServerReachability returns true from a single successful ping', async () => {
	const calls = createHarness([5], [true])
	assertEquals(await probeServerReachability(calls.options), true)
	assertEquals(calls.fetches, 1)
	assertEquals(calls.sleeps, [])
})

Deno.test('probeServerReachability waits half the measured round-trip before the retry', async () => {
	// 隧道般的慢通道：第一次 2000ms 失败，复核成功。
	const calls = createHarness([2000, 2000], [false, true])
	assertEquals(await probeServerReachability(calls.options), true)
	assertEquals(calls.fetches, 2)
	assertEquals(calls.sleeps, [2000 * WAKE_PROBE_GRACE_RATIO])
})

Deno.test('probeServerReachability keeps the derived budget above the floor for fast channels', async () => {
	// 本机那样的快通道：50ms 失败 → 预算按下限，而不是 75ms。
	const calls = createHarness([50, 50], [false, false])
	assertEquals(await probeServerReachability(calls.options), false)
	assertEquals(calls.fetches, 2)
	assertEquals(calls.sleeps, [50 * WAKE_PROBE_GRACE_RATIO])
	const expectedBudget = Math.max(50 * WAKE_PROBE_RTT_FACTOR, WAKE_PROBE_MIN_BUDGET_MS)
	assertEquals(expectedBudget, WAKE_PROBE_MIN_BUDGET_MS)
	assertEquals(WAKE_PROBE_MIN_BUDGET_MS > 50 * WAKE_PROBE_RTT_FACTOR, true)
})

Deno.test('probeServerReachability gives up after the retry and never loops', async () => {
	const calls = createHarness([100, 100, 100], [false, false, false])
	assertEquals(await probeServerReachability(calls.options), false)
	assertEquals(calls.fetches, 2)
})

Deno.test('probeServerReachability treats a bootstrap timeout as a slow channel, not as an instant failure', async () => {
	// 第一次请求耗尽测速上限：实测时延即上限本身，因此复核预算与 grace 都按它推导（不会退化成固定 500ms）。
	const calls = createHarness([15000, 1000], [false, true])
	assertEquals(await probeServerReachability(calls.options), true)
	assertEquals(calls.sleeps, [15000 * WAKE_PROBE_GRACE_RATIO])
})

Deno.test('probeServerReachability stops on the caller signal and skips the retry', async () => {
	// SW 先答「可以」时会中止这次探测：请求被中止，且不再按预算复核第二次。
	const controller = new AbortController()
	const calls = createHarness([1000, 1000], [false, true], { abortable: true })
	const pending = probeServerReachability({ ...calls.options, signal: controller.signal })
	// 第一次请求还在飞的时候就中止：请求被中止，且不再按预算复核第二次。
	controller.abort()
	assertEquals(await pending, false)
	assertEquals(calls.fetches, 1)
})

Deno.test('firstPositive returns the first positive candidate without waiting for the slow one', async () => {
	const slowNegative = new Promise(resolve => setTimeout(() => resolve(false), 50))
	assertEquals(await firstPositive([Promise.resolve(true), slowNegative]), true)
})

Deno.test('firstPositive only returns false once every candidate has settled negative', async () => {
	const settled = []
	const slowNegative = new Promise(resolve => setTimeout(() => { settled.push('slow'); resolve(false) }, 20))
	assertEquals(await firstPositive([slowNegative, Promise.resolve(false)]), false)
	assertEquals(settled, ['slow'])
})

Deno.test('firstPositive treats a rejected candidate as negative instead of letting it win', async () => {
	assertEquals(await firstPositive([Promise.reject(new Error('boom')), Promise.resolve(true)]), true)
	assertEquals(await firstPositive([Promise.reject(new Error('boom')), Promise.resolve(false)]), false)
})
