/**
 * 【文件】public/src/ui/channelDisplay.mjs
 * 【职责】频道消息展示链：DAG 边排序、分支折叠、反应计票与投票人列表。
 * 【原理】applyChannelDisplayChain 合并 activeBranches；tallyReactions/tallyReactionVoters 扫描 reaction 事件。
 * 【数据结构】mergedMessages[]、activeBranches、viewerMemberPubKeyHash。
 * 【关联】reactionHandlers；Hub messages/render。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'
/**
 * 稳定比较两条 DAG 边（时间戳升序，其次 eventId 字典序）。
 * @param {object} left 消息行
 * @param {object} right 消息行
 * @returns {number} sort 比较值
 */
function compareSiblingOrder(left, right) {
	const leftTime = Number(left?.timestamp)
	const rightTime = Number(right?.timestamp)
	const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0
	const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0
	if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight
	return String(left?.eventId ?? '').localeCompare(String(right?.eventId ?? ''), 'und')
}

/**
 * @param {object} message 消息行
 * @returns {string[]} 父 event id（字典序）
 */
function parentEventIds(message) {
	if (!Array.isArray(message?.prev_event_ids) || !message.prev_event_ids.length) return []
	return [...message.prev_event_ids].filter(isHex64).sort()
}

/**
 * @param {object} message 子消息
 * @param {Map<string, object>} messagesByEventId eventId → 行
 * @returns {string | null} 展示父 eventId
 */
function displayParentEventId(message, messagesByEventId) {
	const parents = parentEventIds(message).filter(parentId => messagesByEventId.has(parentId))
	if (!parents.length) return null
	let latestParent = parents[0]
	for (let index = 1; index < parents.length; index++) {
		const candidate = parents[index]
		if (compareSiblingOrder(messagesByEventId.get(candidate), messagesByEventId.get(latestParent)) > 0)
			latestParent = candidate
	}
	return latestParent
}

/** @type {WeakMap<object[], { length: number, map: Map<string, object> }>} */
const messagesByEventIdCache = new WeakMap()

/**
 * 构建页级 eventId→行 Map（hex64 消息）；同一数组引用且 length 未变时复用。
 * @param {object[]} allMessages 频道内全部展示行
 * @returns {Map<string, object>} eventId → 行
 */
export function buildMessagesByEventId(allMessages) {
	if (!Array.isArray(allMessages)) return new Map()
	const cached = messagesByEventIdCache.get(allMessages)
	if (cached && cached.length === allMessages.length) return cached.map
	/** @type {Map<string, object>} */
	const map = new Map()
	for (const row of allMessages) {
		if (!row?.eventId || !isHex64(row.eventId)) continue
		map.set(String(row.eventId).trim().toLowerCase(), row)
	}
	messagesByEventIdCache.set(allMessages, { length: allMessages.length, map })
	return map
}

/**
 * @param {object[]} mergedMessages 服务端物化后的消息行
 * @param {Map<string, string>} activeBranches 分叉点父 id → 选中的子 eventId
 * @returns {{ messages: object[], branchInfo: Map<string, { alternatives: object[], selectedIdx: number, branchKey: string }> }} 展示序与分叉元数据
 */
function buildDisplayChain(mergedMessages, activeBranches) {
	const chainable = mergedMessages.filter(message => message?.eventId && isHex64(message.eventId))
	if (!chainable.length)
		return { messages: mergedMessages, branchInfo: new Map() }
	if (!chainable.some(message => parentEventIds(message).length > 0))
		return { messages: mergedMessages, branchInfo: new Map() }

	const messagesByEventId = new Map(chainable.map(message => [String(message.eventId).toLowerCase(), message]))
	const hasExternalParent = chainable.some(message =>
		parentEventIds(message).length > 0
		&& !parentEventIds(message).some(parentId => messagesByEventId.has(parentId)),
	)
	if (hasExternalParent)
		return { messages: [...chainable].sort(compareSiblingOrder), branchInfo: new Map() }

	const childCountByParent = new Map()
	for (const message of chainable) {
		const parentId = displayParentEventId(message, messagesByEventId)
		if (!parentId) continue
		childCountByParent.set(parentId, (childCountByParent.get(parentId) || 0) + 1)
	}
	const hasBranch = [...childCountByParent.values()].some(count => count > 1)
	if (!hasBranch)
		return { messages: [...chainable].sort(compareSiblingOrder), branchInfo: new Map() }

	const childrenByParent = new Map()
	for (const message of chainable) {
		const parentId = displayParentEventId(message, messagesByEventId)
		if (!parentId) continue
		if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
		childrenByParent.get(parentId).push(message)
	}
	for (const children of childrenByParent.values())
		children.sort(compareSiblingOrder)

	const roots = chainable
		.filter(message => !displayParentEventId(message, messagesByEventId))
		.sort(compareSiblingOrder)
	if (!roots.length)
		return { messages: mergedMessages, branchInfo: new Map() }

	const displayOrder = [...roots]
	const branchInfo = new Map()
	let cursor = roots[roots.length - 1]?.eventId ?? null
	const visited = new Set()

	while (cursor && !visited.has(cursor)) {
		visited.add(cursor)
		const children = childrenByParent.get(cursor)
		if (!children?.length) break
		if (children.length === 1) {
			displayOrder.push(children[0])
			cursor = children[0].eventId
			continue
		}
		const activeChildId = activeBranches.get(cursor)
		const selected = children.find(message => message.eventId === activeChildId) ?? children[0]
		branchInfo.set(selected.eventId, {
			alternatives: children,
			selectedIdx: children.indexOf(selected),
			branchKey: cursor,
		})
		displayOrder.push(selected)
		cursor = selected.eventId
	}

	const seen = new Set(displayOrder.map(message => message.eventId))
	const tail = chainable.filter(message => !seen.has(message.eventId)).sort(compareSiblingOrder)
	if (tail.length) displayOrder.push(...tail)
	return { messages: displayOrder, branchInfo }
}

/**
 * 对已合并的频道消息应用展示 DAG 链（Hub / channelView 共用）。
 * @param {object[]} mergedMessages 已 merge 的消息行
 * @param {Map<string, string>} [activeBranches] 分叉选择
 * @returns {object[]} 展示序消息
 */
export function applyChannelDisplayChain(mergedMessages, activeBranches = new Map()) {
	return buildDisplayChain(mergedMessages, activeBranches).messages
}

/**
 * 重放 reaction 事件。
 * @param {object[]} channelMessages 频道全部事件行
 * @param {string} targetEventId 目标消息 eventId
 * @returns {Map<string, Map<string, boolean>>} voter → emoji → active
 */
function replayReactions(channelMessages, targetEventId) {
	const reactionsByVoter = new Map()
	const target = String(targetEventId)
	for (const message of channelMessages) {
		if (message.type !== 'reaction_add' && message.type !== 'reaction_remove') continue
		if (String(message.content?.targetId) !== target) continue
		const emoji = message.content?.emoji
		if (!emoji) continue
		const actor = message.sender || message.eventId
		const voter = message.type === 'reaction_remove' && message.content?.targetPubKeyHash
			? message.content.targetPubKeyHash
			: actor
		if (!reactionsByVoter.has(voter)) reactionsByVoter.set(voter, new Map())
		reactionsByVoter.get(voter).set(emoji, message.type === 'reaction_add')
	}
	return reactionsByVoter
}

/**
 * @param {Record<string, Record<string, { voters?: string[] }>> | undefined} reactionsMap 聚合反应
 * @param {string} targetEventId 目标消息 eventId
 * @param {string} [viewerId='local'] 本机成员标识
 * @returns {Map<string, { count: number, byMe: boolean }>} emoji → 计票
 */
export function tallyReactionsFromMap(reactionsMap, targetEventId, viewerId = 'local') {
	const emojiMap = reactionsMap?.[targetEventId]
		|| reactionsMap?.[String(targetEventId).trim()]
	const tallies = new Map()
	if (!emojiMap) return tallies
	for (const [emoji, detail] of Object.entries(emojiMap)) {
		const voters = Array.isArray(detail?.voters) ? detail.voters : []
		tallies.set(emoji, {
			count: voters.length,
			byMe: voters.some(voter => voter === viewerId),
		})
	}
	return tallies
}

/**
 * @param {Record<string, Record<string, { voters?: string[] }>> | undefined} reactionsMap 聚合反应
 * @param {string} targetEventId 目标消息 eventId
 * @param {string} [viewerId='local'] 本机成员标识
 * @returns {Map<string, { count: number, byMe: boolean, voters: string[] }>} emoji → 计票与投票者
 */
export function tallyReactionVotersFromMap(reactionsMap, targetEventId, viewerId = 'local') {
	const emojiMap = reactionsMap?.[targetEventId]
		|| reactionsMap?.[String(targetEventId).trim()]
	const tallies = new Map()
	if (!emojiMap) return tallies
	for (const [emoji, detail] of Object.entries(emojiMap)) {
		const voters = Array.isArray(detail?.voters) ? detail.voters : []
		tallies.set(emoji, {
			count: voters.length,
			byMe: voters.some(voter => voter === viewerId),
			voters: [...voters],
		})
	}
	return tallies
}

/**
 * @param {object[]} channelMessages 频道全部事件行
 * @param {string} targetEventId 目标消息 eventId
 * @param {string} [viewerId='local'] 本机成员标识
 * @returns {Map<string, { count: number, byMe: boolean }>} emoji → 计票
 */
export function tallyReactions(channelMessages, targetEventId, viewerId = 'local') {
	const reactionsByVoter = replayReactions(channelMessages, targetEventId)
	const tallies = new Map()
	for (const [sender, emojis] of reactionsByVoter)
		for (const [emoji, active] of emojis) {
			if (!active) continue
			const previous = tallies.get(emoji) || { count: 0, byMe: false }
			tallies.set(emoji, {
				count: previous.count + 1,
				byMe: previous.byMe || sender === viewerId,
			})
		}
	return tallies
}

/**
 * @param {object[]} channelMessages 频道事件
 * @param {string} targetEventId 目标消息 eventId
 * @param {string} [viewerId='local'] 本机成员标识
 * @returns {Map<string, { count: number, byMe: boolean, voters: string[] }>} emoji → 计票与投票者
 */
export function tallyReactionVoters(channelMessages, targetEventId, viewerId = 'local') {
	const reactionsByVoter = replayReactions(channelMessages, targetEventId)
	const tallies = new Map()
	for (const [sender, emojis] of reactionsByVoter)
		for (const [emoji, active] of emojis) {
			if (!active) continue
			const previous = tallies.get(emoji) || { count: 0, byMe: false, voters: [] }
			previous.count += 1
			if (sender === viewerId) previous.byMe = true
			previous.voters.push(sender)
			tallies.set(emoji, previous)
		}
	return tallies
}
