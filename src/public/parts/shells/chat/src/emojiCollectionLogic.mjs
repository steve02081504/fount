/**
 * 表情收藏 / 默认包收敛纯逻辑（无 I/O）。
 */

/**
 * 群默认包：显式设置优先，否则回落 packId===groupId。
 * @param {object | null | undefined} groupSettings 群设置
 * @param {string} groupId 群 ID
 * @returns {string} 默认 packId
 */
export function resolveGroupDefaultPackId(groupSettings, groupId) {
	const explicit = String(groupSettings?.defaultEmojiPackId || '').trim()
	return explicit || String(groupId || '').trim()
}

/**
 * @param {string} groupId 群 ID
 * @returns {string} linkedDefaults 键
 */
export function groupDefaultLinkKey(groupId) {
	return `group:${String(groupId || '').trim()}`
}

/**
 * @param {string} entityHash 作者 entityHash
 * @returns {string} linkedDefaults 键
 */
export function entityDefaultLinkKey(entityHash) {
	return `entity:${String(entityHash || '').trim().toLowerCase()}`
}

/**
 * 默认包收藏收敛（纯函数）：返回新的 packIds。
 * @param {string[]} packIds 当前收藏
 * @param {string | null | undefined} oldDefaultPackId 旧默认
 * @param {string | null | undefined} newDefaultPackId 新默认
 * @returns {string[]} 更新后的收藏
 */
export function applyDefaultPackConverge(packIds, oldDefaultPackId, newDefaultPackId) {
	const next = String(newDefaultPackId || '').trim()
	if (!next) return [...packIds]
	const old = String(oldDefaultPackId || '').trim()
	if (old === next) return [...packIds]
	const packs = [...packIds]
	const oldIdx = old ? packs.indexOf(old) : -1
	if (oldIdx >= 0) 
		if (!packs.includes(next)) packs[oldIdx] = next
		else packs.splice(oldIdx, 1)
	
	else if (!old && !packs.includes(next))
		packs.push(next)
	return packs
}
