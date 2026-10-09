/**
 * 服务器可达性探测（页面启动路径）的判定逻辑。
 * 与 `service_worker_policy.mjs` 一样不依赖 DOM，便于在 Deno 里直接单测。
 *
 * 为什么预算要按实测时延推导：这里一旦判成「不可达」，`wakeServer()` 就会去拉起 `fount://` 协议处理器，
 * 浏览器会因此报错；而写死的毫秒数在隧道/代理这类慢通道上（本机 `/api/ping` 几毫秒、隧道 2 秒以上）必然误判。
 */

/** 测速请求的上限（毫秒）：只用于避免死等，给足以覆盖慢通道。 */
export const WAKE_PROBE_BOOTSTRAP_TIMEOUT_MS = 15000

/** 判定预算的系数：预算 = 实测往返时延 × 该系数。 */
export const WAKE_PROBE_RTT_FACTOR = 1.5

/** 判定预算的下限（毫秒）：实测时延很小时也要留出首包抖动的余量。 */
export const WAKE_PROBE_MIN_BUDGET_MS = 1200

/** 资源探测结束后额外等待「实测时延 × 该系数」再复核：并行的 Service Worker 唤醒可能正好在这段时间成功。 */
export const WAKE_PROBE_GRACE_RATIO = 0.5

/**
 * 请求一次 `/api/ping`，并记录本通道的往返时延。
 * @param {object} params - 参数对象。
 * @param {typeof fetch} params.fetchImpl - fetch 实现（测试可注入）。
 * @param {() => number} params.now - 单调时钟（测试可注入）。
 * @param {number} params.timeoutMs - 本次请求的上限（毫秒）。
 * @param {AbortSignal} [params.signal] - 外部中止信号（例如并行的 Service Worker 询问已经有了肯定答案）。
 * @returns {Promise<{ reachable: boolean, elapsedMs: number }>} 是否可达与本次耗时。
 */
async function pingOnce({ fetchImpl, now, timeoutMs, signal }) {
	const startedAt = now()
	const timeoutSignal = AbortSignal.timeout(timeoutMs)
	try {
		const response = await fetchImpl('/api/ping', {
			method: 'GET',
			mode: 'cors',
			credentials: 'omit',
			cache: 'no-store',
			signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
		})
		return { reachable: response.ok, elapsedMs: now() - startedAt }
	}
	catch {
		return { reachable: false, elapsedMs: now() - startedAt }
	}
}

/**
 * 探测服务器是否可达：第一次请求既测速又初判，失败时等「实测时延 × `WAKE_PROBE_GRACE_RATIO`」，
 * 再按「实测时延 × `WAKE_PROBE_RTT_FACTOR`」（下限 `WAKE_PROBE_MIN_BUDGET_MS`）复核一次。
 * @param {object} [options] - 注入点。
 * @param {typeof fetch} [options.fetchImpl] - fetch 实现。
 * @param {(ms: number) => Promise<void>} [options.sleep] - 等待实现。
 * @param {() => number} [options.now] - 单调时钟。
 * @param {number} [options.bootstrapTimeoutMs] - 测速请求上限。
 * @param {AbortSignal} [options.signal] - 外部中止信号（不再需要这次探测时中止，省掉请求）。
 * @returns {Promise<boolean>} 是否可达。
 */
export async function probeServerReachability({
	fetchImpl = globalThis.fetch,
	sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
	now = () => performance.now(),
	bootstrapTimeoutMs = WAKE_PROBE_BOOTSTRAP_TIMEOUT_MS,
	signal,
} = {}) {
	const first = await pingOnce({ fetchImpl, now, timeoutMs: bootstrapTimeoutMs, signal })
	if (first.reachable) return true
	if (signal?.aborted) return false

	const budgetMs = Math.max(first.elapsedMs * WAKE_PROBE_RTT_FACTOR, WAKE_PROBE_MIN_BUDGET_MS)
	await sleep(first.elapsedMs * WAKE_PROBE_GRACE_RATIO)
	if (signal?.aborted) return false
	const retry = await pingOnce({ fetchImpl, now, timeoutMs: budgetMs, signal })
	return retry.reachable
}

/** 永不 settle 的 Promise：用于「这个候选没有肯定答案」时把竞争让给别的候选。 */
const NEVER = new Promise(() => { })

/**
 * 取多个候选里第一个肯定的结果；只有全部候选都明确否定（或失败）时才返回 false。
 * 失败的候选不会让整体提前返回——否则「Service Worker 说不行、但资源探测说可达」会被误判成不可达。
 * @param {Array<Promise<boolean>>} candidates - 候选结果
 * @returns {Promise<boolean>} 是否有候选给出了肯定答案
 */
export async function firstPositive(candidates) {
	const settled = candidates.map(candidate => Promise.resolve(candidate).catch(() => false))
	const positives = settled.map(candidate => candidate.then(value => value ? true : NEVER))
	return await Promise.race([...positives, Promise.all(settled).then(values => values.some(Boolean))])
}
