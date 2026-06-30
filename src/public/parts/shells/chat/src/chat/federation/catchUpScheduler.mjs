/**
 * 【文件】federation/catchUpScheduler.mjs
 * 【职责】方案3 兜底调度器：把入站发现的“本地落后”信号（tip 对比落差、dag_event 缺父）防抖+冷却地汇聚成有界的 catchUpGroupFromPeers 调用，修复实时推送漏帧后的最终一致性。
 * 【原理】每 (username, groupId) 一个槽：~1.5s 防抖合并高频信号；两次真实补齐间至少 ~15s 冷却（冷却期内的需求延后到冷却结束再执行一次，不丢需求）；wantIds 退避中直接硬闸跳过，避免补齐风暴。补齐本身仍由 catchUpGroupFromPeers 走既有校验管线，本模块只决定“何时触发”。
 * 【数据结构】scheduleByKey: Map<`${username}\0${groupId}`, { timer, lastRunAt }>。
 * 【关联】被 roomHandlers/sync.mjs 的 fed_tip_ping/pong 与 dag_event handler 调用；触发 index.mjs catchUpGroupFromPeers；硬闸读 scripts/p2p/want_ids.mjs。
 */
import { isWantIdsInBackoff, wantIdsGroupKey } from '../../../../../../../scripts/p2p/want_ids.mjs'

import { catchUpGroupFromPeers } from './index.mjs'

/** 合并 ~1.5s 内的多次调度信号为一次实际补齐尝试。 */
const DEBOUNCE_MS = 1_500

/** 同一 group 两次真实补齐之间的最小冷却间隔。 */
const COOLDOWN_MS = 15_000

/** 触发补齐时的 tip 交换等待窗口（短，避免 live 路径阻塞）。 */
const CATCHUP_WAIT_MS = 800

/** @type {Map<string, { timer: ReturnType<typeof setTimeout> | null, lastRunAt: number }>} */
const scheduleByKey = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} 调度槽键
 */
function scheduleKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * 实际触发（或在冷却期内延后再触发）有界补齐。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ timer: ReturnType<typeof setTimeout> | null, lastRunAt: number }} entry 调度槽
 * @returns {void}
 */
function runOrDefer(username, groupId, entry) {
	entry.timer = null
	// 硬闸：处于 wantIds 退避中直接跳过，避免补齐风暴（信号会被后续 tip 心跳重新触发）。
	if (isWantIdsInBackoff(wantIdsGroupKey( groupId))) return
	const now = Date.now()
	const sinceLast = now - entry.lastRunAt
	if (sinceLast < COOLDOWN_MS) {
		// 冷却未到：把这次需求延后到冷却结束再执行一次，不丢需求。
		entry.timer = setTimeout(() => runOrDefer(username, groupId, entry), COOLDOWN_MS - sinceLast)
		return
	}
	entry.lastRunAt = now
	void catchUpGroupFromPeers(username, groupId, { waitMs: CATCHUP_WAIT_MS }).catch(console.error)
}

/**
 * 防抖+冷却地调度一次有界补齐。可被高频调用而不放大负载。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function scheduleCatchUp(username, groupId) {
	if (!username || !groupId) return
	// 硬闸前置：退避中连定时器都不必排（省内存/省 tick）。
	if (isWantIdsInBackoff(wantIdsGroupKey( groupId))) return
	const key = scheduleKey(username, groupId)
	let entry = scheduleByKey.get(key)
	if (!entry) {
		entry = { timer: null, lastRunAt: 0 }
		scheduleByKey.set(key, entry)
	}
	// 已有待触发定时器（防抖窗口或冷却延后）：合并本次信号。
	if (entry.timer) return
	entry.timer = setTimeout(() => runOrDefer(username, groupId, entry), DEBOUNCE_MS)
}

/**
 * 取消并清理某 group 的待触发补齐（群删除 / slot 失效路径调用）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function cancelScheduledCatchUp(username, groupId) {
	const key = scheduleKey(username, groupId)
	const entry = scheduleByKey.get(key)
	if (entry?.timer) clearTimeout(entry.timer)
	scheduleByKey.delete(key)
}
