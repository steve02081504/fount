/**
 * 【文件】dag/permissionBlockOwner.mjs
 * 【职责】沿 `permissionBlockId` 指针解析频道权限块来源（循环保护），供 reducer 与物化状态复用。
 */

/**
 * 解析某频道的权限块来源：沿 `permissionBlockId` 指针上溯（循环保护），返回拥有自己覆写的源频道 id。
 * `permissionBlockId === null` 的频道拥有自己的块；沿链到 `null` 或缺失频道即终止。
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {string} 拥有权限覆写的源频道 id
 */
export function resolvePermissionBlockOwner(state, channelId) {
	let current = channelId
	const seen = new Set()
	while (current && !seen.has(current)) {
		seen.add(current)
		const channel = state.channels?.[current]
		if (!channel) break
		const blockId = channel.permissionBlockId
		if (!blockId) break
		current = blockId
	}
	return current
}
