/**
 * 联邦 catchup 待补集与 joinSnapshot 重试决策纯函数单测。
 * 钉住 catchup 重试偶发 flake 的两个根因：
 * ① extraWantIds 仅在 gossip 首轮生效——首轮若被 want-ids 限速/链路抖动，后续轮不再定向索要；
 * ② joinSnapshot 在候选分歧（全部应答但仲裁无赢家）时仍盲目重试——每轮烧 ~57s，挤垮 180s 窗口。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { shouldRetryJoinSnapshotPull } from '../../src/chat/federation/joinSnapshot.mjs'
import { computeCatchupWantSet } from '../../src/chat/federation/wantSet.mjs'

/**
 * @param {string} seed 字符种子
 * @returns {string} 合法 64 位小写 hex 事件 id
 */
const id = seed => seed.repeat(64)

/**
 * @returns {{ remoteTips: string[], byId: Map<string, object>, deferredRows: object[], locallyKnown: Set<string> }} 采样上下文
 */
function sampleContext() {
	// byId 含 b，其父 c 缺失；deferred 含 d，其父 e 缺失；两者均不在 locallyKnown。
	const remoteTips = [id('a')]
	const byId = new Map([[id('b'), { id: id('b'), prev_event_ids: [id('c')] }]])
	const deferredRows = [{ event: { id: id('d'), prev_event_ids: [id('e')] } }]
	const locallyKnown = new Set([])
	return { remoteTips, byId, deferredRows, locallyKnown }
}

Deno.test('computeCatchupWantSet wants parents of local and deferred events', () => {
	const context = sampleContext()
	const want = computeCatchupWantSet(context.remoteTips, context.byId, context.deferredRows, context.locallyKnown, [])
	// remote tip + missing parents of local & deferred events
	assertEquals(new Set(want), new Set([id('a'), id('c'), id('e')]))
})

Deno.test('computeCatchupWantSet keeps extraWantIds on every iteration (not only first)', () => {
	const context = sampleContext()
	const extra = id('f')
	// 第二+轮（includeExtra=false）：显式索要的 id 必须仍然保留——否则首轮限速/丢包后便永不重新定向索要。
	const want = computeCatchupWantSet(context.remoteTips, context.byId, context.deferredRows, context.locallyKnown, [extra])
	assert(want.includes(extra))
})

Deno.test('shouldRetryJoinSnapshotPull skips retry when all peers answered but no winner', () => {
	// 候选分歧（例如对端 checkpoint 版本不一致）重试不收敛，应立即放弃而非空转。
	assertEquals(shouldRetryJoinSnapshotPull(
		[{ responderNodeHash: id('x') }, { responderNodeHash: id('y') }],
		[id('x'), id('y')],
	), false)
})

Deno.test('shouldRetryJoinSnapshotPull retries on transport shortfall', () => {
	// 部分 peer 静默（应答数 < 目标数）可能是抖动，值得重试。
	assertEquals(shouldRetryJoinSnapshotPull(
		[{ responderNodeHash: id('x') }],
		[id('x'), id('y')],
	), true)
})

Deno.test('shouldRetryJoinSnapshotPull retries broadcast when nothing answers', () => {
	// 无目标时走广播：无人应答可能是传输抖动/静默，值得重试而非立即放弃。
	assertEquals(shouldRetryJoinSnapshotPull([], []), true)
})
