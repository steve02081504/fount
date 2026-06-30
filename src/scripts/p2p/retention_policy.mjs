import { sortedPrevEventIds } from './dag/index.mjs'
import { getPermissionAnchorTypes } from './event_type_registry.mjs'
import {
	authzFoldOrderIds,
	descendantClosureFromTip,
} from './governance_branch.mjs'


/** 裁剪时不得早于最早一条权限锚点事件（§7.1）。 */
export { getPermissionAnchorTypes }

/**
 * @param {string[]} order 拓扑序 id 列表
 * @param {Map<string, object>} byId id → 事件
 * @returns {number} 最早须保留的事件下标
 */
export function permissionAnchorStartIndex(order, byId) {
	let anchor = order.length
	for (let index = order.length - 1; index >= 0; index--) {
		const ev = byId.get(order[index])
		if (ev && getPermissionAnchorTypes().has(ev.type)) anchor = index
	}
	return anchor
}

/**
 * 在共识分支上计算须保留的事件 id（连通子图，不用拓扑下标切片）。
 * @param {string[]} order 规范拓扑序
 * @param {Map<string, object>} byId id → 事件
 * @param {object} opts 保留策略
 * @param {number} opts.maxDepth 分支上最大事件深度
 * @param {number} opts.cutoffWall 最早保留的 HLC wall
 * @param {Set<string>} opts.anchorTypes 权限锚点事件类型
 * @param {string | null} [opts.checkpointTipId] checkpoint 尖
 * @param {string | null} [opts.branchTipId] 共识分支尖
 * @returns {Set<string>} 保留 id
 */
export function computeRetentionKeepIds(order, byId, opts) {
	const { maxDepth, cutoffWall, anchorTypes, checkpointTipId, branchTipId } = opts
	const branchOrder = authzFoldOrderIds(order, byId, branchTipId)
	const branchSet = new Set(branchOrder)
	if (!branchSet.size) return new Set()

	/** @type {Set<string>} */
	const keep = new Set()
	/** @type {Set<string>} */
	const ancestorSeeds = new Set()

	if (checkpointTipId && branchSet.has(checkpointTipId))
		for (const id of descendantClosureFromTip(checkpointTipId, byId))
			if (branchSet.has(id)) keep.add(id)

	for (let index = branchOrder.length - 1; index >= 0; index--) {
		const ev = byId.get(branchOrder[index])
		if (ev && anchorTypes.has(ev.type)) {
			ancestorSeeds.add(branchOrder[index])
			break
		}
	}

	for (const id of branchOrder) {
		const ev = byId.get(id)
		const wall = Number(ev?.hlc?.wall ?? 0)
		if (wall >= cutoffWall) ancestorSeeds.add(id)
	}

	if (branchOrder.length > maxDepth)
		for (const id of branchOrder.slice(-maxDepth))
			ancestorSeeds.add(id)

	const stack = [...ancestorSeeds]
	while (stack.length) {
		const id = stack.pop()
		if (!id || !branchSet.has(id) || keep.has(id)) continue
		keep.add(id)
		const event = byId.get(id)
		if (!event) continue
		for (const parentId of sortedPrevEventIds(event.prev_event_ids))
			if (branchSet.has(parentId)) stack.push(parentId)
	}

	if (!keep.size)
		for (const id of branchOrder) keep.add(id)

	return keep
}
