/**
 * @param {object} stateJson `/groups/:id/state` 的 JSON
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<boolean>} 是否可执行频道加密迁移类管理操作
 */
export async function viewerCanCryptoMigrate(stateJson, groupId, channelId) {
	if (!stateJson) return false
	const members = Array.isArray(stateJson.members) ? stateJson.members : []
	if (members.length === 0) return true
	const h = stateJson.viewerMemberPubKeyHash
	if (!h) return false
	const pr = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/permissions?pubKeyHash=${encodeURIComponent(h)}&channelId=${encodeURIComponent(channelId)}`)
	if (!pr.ok) return false
	const p = await pr.json()
	return p.ADMIN === true || p.MANAGE_CHANNELS === true
}

/**
 * @param {object} stateJson `/groups/:id/state` 的 JSON
 * @param {string} groupId 群组 ID
 * @returns {Promise<boolean>} 当前查看者是否具备发起继任投票（管理员）资格
 */
export async function viewerCanOwnerSuccession(stateJson, groupId) {
	if (!stateJson) return false
	const members = Array.isArray(stateJson.members) ? stateJson.members : []
	if (members.length === 0) return true
	const h = stateJson.viewerMemberPubKeyHash
	if (!h) return false
	const chId = stateJson.groupSettings?.defaultChannelId || Object.keys(stateJson.channels || {})[0] || 'default'
	const pr = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/permissions?pubKeyHash=${encodeURIComponent(h)}&channelId=${encodeURIComponent(chId)}`)
	if (!pr.ok) return false
	const p = await pr.json()
	return p.ADMIN === true
}

/**
 * 与 `viewerCanOwnerSuccession` 相同：服务端 `home_transfer` 阈值验签集合为物化状态中具备 ADMIN 的登记成员。
 *
 * @param {object} stateJson `/groups/:id/state` 的 JSON
 * @param {string} groupId 群组 ID
 * @returns {Promise<boolean>} 当前查看者是否具备发起 home 迁移相关治理操作资格
 */
export async function viewerCanHomeTransfer(stateJson, groupId) {
	return viewerCanOwnerSuccession(stateJson, groupId)
}
