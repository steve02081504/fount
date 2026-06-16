/**
 * 【文件】channel/gc.mjs
 * 【职责】§6.2 频道 GC 候选发现：沉寂 ≥30 天且从默认频道 DAG 不可达的孤岛频道。
 * 【原理】findStaleUnreachableChannels 扫描物化 channels 与 events 可达性图，排除 CHANNEL_GC_EXCLUDED_EVENT_TYPES。
 *   当 groupSettings.autoChannelGc !== false 时，dag/materialize 在 checkpoint 重建时每次最多自动 channel_delete 2 个候选。
 * 【数据结构】lastActivityByChannel Map；返回 channelId 列表。
 * 【关联】dag/materialize、channel_delete、scripts/p2p/event_types。
 */
import { CHANNEL_GC_EXCLUDED_EVENT_TYPES } from '../../../../../../../scripts/p2p/event_types.mjs'

const GC_IDLE_MS = 30 * 24 * 3600 * 1000

const CHANNEL_ACTIVITY_TYPES = new Set([
	'message',
	'message_edit',
	'message_delete',
	'reaction_add',
	'reaction_remove',
	'pin_message',
	'unpin_message',
	'list_item_update',
])

/**
 * 从默认频道经 `parentChannelId` / `list_item_update.targetChannelId` 做可达性（含环）。
 * @param {object} channels 物化频道表
 * @param {string} defaultChannelId 默认频道
 * @returns {Set<string>} 可达 channelId
 */
function reachableFromDefault(channels, defaultChannelId) {
	const reachable = new Set()
	if (!defaultChannelId || !channels?.[defaultChannelId]) return reachable
	const stack = [defaultChannelId]
	while (stack.length) {
		const id = stack.pop()
		if (!id || reachable.has(id)) continue
		if (!channels[id]) continue
		reachable.add(id)
		const channel = channels[id]
		if (channel.parentChannelId && channels[channel.parentChannelId])
			stack.push(channel.parentChannelId)
		for (const other of Object.values(channels)) {
			if (other?.parentChannelId === id && other.id) stack.push(other.id)
			const items = other?.manualItems
			if (Array.isArray(items))
				for (const it of items)
					if (it?.targetChannelId) stack.push(it.targetChannelId)
		}
	}
	return reachable
}

/**
 * 扫描 DAG 得到各频道最后活动时间（不含 VOLATILE / 纯治理类）。
 * @param {object[]} events 事件行
 * @returns {Map<string, number>} channelId → 最近 wall 时间
 */
function lastActivityByChannel(events) {
	/** @type {Map<string, number>} */
	const map = new Map()
	for (const ev of events) {
		if (CHANNEL_GC_EXCLUDED_EVENT_TYPES.has(ev.type)) continue
		if (!CHANNEL_ACTIVITY_TYPES.has(ev.type)) continue
		const activityChannelId = ev.channelId
		if (!activityChannelId) continue
		const t = Number(ev.hlc?.wall ?? 0)
		if (!Number.isFinite(t)) continue
		const prev = map.get(activityChannelId) ?? 0
		if (t > prev) map.set(activityChannelId, t)
	}
	return map
}

/**
 * 返回满足 GC 条件的频道 id（不自动删，由调用方发 `channel_delete`）。
 * @param {object} state 物化状态
 * @param {object[]} events DAG 事件
 * @param {number} [nowMs] 当前时间
 * @returns {string[]} 待 GC 频道 id
 */
export function findStaleUnreachableChannels(state, events, nowMs = Date.now()) {
	const channels = state.channels
	const defaultId = state.groupSettings?.defaultChannelId || 'default'
	const reachable = reachableFromDefault(channels, defaultId)
	const lastAct = lastActivityByChannel(events)
	/** @type {string[]} */
	const stale = []
	for (const channelId of Object.keys(channels)) {
		if (channelId === defaultId) continue
		if (reachable.has(channelId)) continue
		// 频道自身创建时间作为活动下界：新建（无消息）频道的 lastAct 为 0，
		// 若不计入 createdAt 会被立即判定为「沉寂 ≥30 天」而在下一次 checkpoint 重建即遭误删。
		const last = Math.max(lastAct.get(channelId) ?? 0, Number(channels[channelId]?.createdAt) || 0)
		if (nowMs - last < GC_IDLE_MS) continue
		stale.push(channelId)
	}
	return stale
}
