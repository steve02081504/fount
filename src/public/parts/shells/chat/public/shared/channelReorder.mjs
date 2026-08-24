/**
 * 【文件】public/shared/channelReorder.mjs
 * 【职责】频道树重排的纯函数：落点计算与 links 变更推导（Deno-pure，无浏览器依赖）。
 * 【原理】所有移动统一为「从源父节点 `links` 移除，插入目标父节点 `links` 指定位置」；根级父节点即隐藏根容器频道。
 * 【数据结构】`computeMoveOperation` 返回 `{ sourceParentId, targetParentId, targetIndex, placement }`。
 */

/** 落点枚举：移入目标容器 / 目标之前 / 目标之后 / 根级。 */
export const DROP_PLACEMENT = {
	INTO: 'into',
	BEFORE: 'before',
	AFTER: 'after',
	ROOT: 'root',
}

/**
 * 找某频道所在父频道 id（沿 links 反查；不在任何 links 中则为根容器）。
 * @param {Record<string, object>} channels 频道表
 * @param {string} rootChannelId 根容器频道 id
 * @param {string} channelId 目标频道 id
 * @returns {string} 父频道 id
 */
export function findParentChannelId(channels, rootChannelId, channelId) {
	for (const channel of Object.values(channels || {}))
		if (channel?.links?.includes(channelId)) return channel.id
	return rootChannelId
}

/**
 * 判断 `id` 是否位于 `rootId` 的子树内（含 `rootId` 自身）。
 * @param {Record<string, object>} channels 频道表
 * @param {string} rootId 子树根
 * @param {string} id 待判断频道 id
 * @returns {boolean} 子树内为 true
 */
export function isInSubtree(channels, rootId, id) {
	if (id === rootId) return true
	const stack = [rootId]
	const seen = new Set()
	while (stack.length) {
		const current = stack.pop()
		if (seen.has(current)) continue
		seen.add(current)
		for (const childId of channels?.[current]?.links || []) {
			if (childId === id) return true
			stack.push(childId)
		}
	}
	return false
}

/**
 * 计算把 `sourceId` 以 `placement` 落到 `targetId`（`null` 表示根级空白）的操作。
 * 结果给出源父、目标父与目标索引；拖入自身子树等无效落点返回 `null`。
 * @param {Record<string, object>} channels 频道表
 * @param {string} rootChannelId 根容器频道 id
 * @param {string} sourceId 被拖拽频道 id
 * @param {string | null} targetId 落点频道 id（`null` 为根级空白）
 * @param {string} placement `DROP_PLACEMENT` 之一
 * @returns {{ sourceParentId: string, targetParentId: string, targetIndex: number, placement: string } | null} 移动操作或 null
 */
export function computeMoveOperation(channels, rootChannelId, sourceId, targetId, placement) {
	if (sourceId === targetId) return null
	const sourceParentId = findParentChannelId(channels, rootChannelId, sourceId)

	if (placement === DROP_PLACEMENT.ROOT || !targetId) {
		if (isInSubtree(channels, sourceId, rootChannelId)) return null
		return { sourceParentId, targetParentId: rootChannelId, targetIndex: 0, placement: DROP_PLACEMENT.ROOT }
	}

	let targetParentId
	let targetIndex
	if (placement === DROP_PLACEMENT.INTO) {
		if (isInSubtree(channels, sourceId, targetId)) return null
		targetParentId = targetId
		targetIndex = 0
	}
	else {
		const after = placement === DROP_PLACEMENT.AFTER
		targetParentId = findParentChannelId(channels, rootChannelId, targetId)
		if (isInSubtree(channels, sourceId, targetParentId)) return null
		const links = (channels?.[targetParentId]?.links || []).filter(id => id !== sourceId)
		const at = links.indexOf(targetId)
		targetIndex = at < 0 ? (after ? links.length : 0) : after ? at + 1 : at
	}

	return { sourceParentId, targetParentId, targetIndex, placement }
}

/**
 * 从源父 links 移除、向目标父 links 指定位置插入，返回「移除后插入」的新 links（供同父合并时用）。
 * @param {Record<string, object>} channels 频道表
 * @param {object} op `computeMoveOperation` 结果
 * @param {string} sourceId 被拖拽频道 id
 * @returns {{ sourceLinks?: string[], targetLinks: string[] }} 新的 links（源父与目标父不同才含 sourceLinks）
 */
export function buildMoveLinks(channels, op, sourceId) {
	const targetLinks = (channels?.[op.targetParentId]?.links || []).filter(id => id !== sourceId)
	targetLinks.splice(op.targetIndex, 0, sourceId)
	if (op.sourceParentId === op.targetParentId)
		return { targetLinks }
	return {
		sourceLinks: (channels?.[op.sourceParentId]?.links || []).filter(id => id !== sourceId),
		targetLinks,
	}
}
