/**
 * 【文件】federation/tipHeartbeat.mjs
 * 【职责】方案3 提示通道：为每个活跃 federation slot 周期性广播轻量 fed_tip_ping（本地 tips + archiveSummary），让对端发现“有新东西”从而自驱有界补齐，兜底实时 dag_event 漏帧。
 * 【原理】setInterval 心跳：仅在 slot 仍活跃、房内有 peer、且未处于 RTC 过载时才发；复用既有 fed_tip_ping wire action（priority 3，轻量帧），不新增 wire action。心跳句柄由调用方（room.mjs）经 slot.registerCleanup 绑定，slot.leave() 时统一 clearInterval，杜绝孤儿定时器。
 * 【数据结构】ping { nodeHash, tips: string[], archiveSummary }，与 tipExchange.mjs 的 ping 同构。
 * 【关联】room.mjs join 后启动；federationSlot.mjs leave() 清理；archiveHandshake.loadLocalFederationArchive、governance_branch.computeDagTipIdsFromEvents、rtc_connection_budget.isFederationActionAllowedUnderLoad。
 */
import { computeDagTipIdsFromEvents } from 'npm:@steve02081504/fount-p2p/governance/branch'
import { isFederationActionAllowedUnderLoad } from 'npm:@steve02081504/fount-p2p/transport/rtc_connection_budget'

import { loadLocalFederationArchive, wireArchiveSummary } from './archiveHandshake.mjs'
import { requireDagDeps } from './dagDependencies.mjs'

/** 默认心跳间隔。 */
const TIP_HEARTBEAT_INTERVAL_MS = 20_000

/** 心跳间隔下限（防止 groupSettings 覆盖成洪泛）。 */
const TIP_HEARTBEAT_MIN_MS = 5_000

/**
 * 解析心跳间隔：默认 ~20s，groupSettings.tipHeartbeatIntervalMs 可覆盖；batterySaver 时间隔加倍（频率减半）。
 * @param {object} [groupSettings] 群设置（join 期快照）
 * @returns {number} 心跳间隔毫秒
 */
export function tipHeartbeatIntervalMs(groupSettings = {}) {
	const override = Number(groupSettings?.tipHeartbeatIntervalMs)
	const base = Number.isFinite(override) && override >= TIP_HEARTBEAT_MIN_MS
		? override
		: TIP_HEARTBEAT_INTERVAL_MS
	return groupSettings?.batterySaver ? base * 2 : base
}

/**
 * 启动某 slot 的 tip 心跳。
 * @param {object} params 参数
 * @param {import('./federationSlot.mjs').FederationSlot} params.slot 联邦槽
 * @param {string} params.username 用户
 * @param {string} params.groupId 群 ID
 * @param {string} params.nodeHash 本机 nodeHash
 * @param {object} params.groupSettings 群设置（join 期快照，用于 batterySaver/覆盖）
 * @returns {() => void} 停止函数（clearInterval）；必须在 slot.leave() 中调用
 */
export function startTipHeartbeat({ slot, username, groupId, nodeHash, groupSettings }) {
	const intervalMs = tipHeartbeatIntervalMs(groupSettings)
	let stopped = false

	/** @returns {void} 单次心跳：有 peer 且未过载时广播本地 tips。 */
	const tick = () => {
		void (async () => {
			if (stopped || !slot.isActive()) return
			// 无 peer 时跳过（省流）。
			const peerCount = slot.getRoster().length
			if (!peerCount) return
			// RTC 过载时跳过本次心跳（fed_tip_ping 属非关键 action）。
			if (!isFederationActionAllowedUnderLoad(slot.roomKey, 'fed_tip_ping', slot.rtcLimits))
				return
			const { readJsonl } = requireDagDeps()
			const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
			const ping = {
				nodeHash,
				tips: computeDagTipIdsFromEvents(localArchive.events),
				archiveSummary: wireArchiveSummary(localArchive.summary),
			}
			if (stopped || !slot.isActive()) return
			slot.send('fed_tip_ping', ping, null)
		})().catch(error => console.error('federation: tip heartbeat failed', error))
	}

	const timer = setInterval(tick, intervalMs)
	return () => {
		if (stopped) return
		stopped = true
		clearInterval(timer)
	}
}
