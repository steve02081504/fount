/**
 * 【文件】public/src/groupViewerPermissions.mjs
 * 【职责】从 state JSON 解析当前观众在频道上的权限位（发消息、反应、管理等）。
 * 【原理】fetchViewerChannelPermissions 读 viewerMemberPubKeyHash 与 channel 权限表；导出 viewerCan* 便捷判断。
 * 【数据结构】Record<string, boolean> 权限表；stateJson.viewerMemberPubKeyHash。
 * 【关联】Hub composer、reactionHandlers；后端 groups/:id/state。
 */

/**
 * @param {object} stateJson `/groups/:id/state` 的 JSON
 * @returns {string} 治理权限查询用的频道 ID
 */
export function governanceChannelIdFromState(stateJson) {
	return stateJson?.groupSettings?.defaultChannelId
		|| Object.keys(stateJson?.channels || {})[0]
		|| 'default'
}

/**
 * @param {object} stateJson `/groups/:id/state` 的 JSON
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 频道 ID
 * @returns {Promise<Record<string, boolean>>} 权限表
 */
export async function fetchViewerChannelPermissions(stateJson, groupId, channelId) {
	const pubKeyHash = stateJson?.viewerMemberPubKeyHash
	if (!pubKeyHash) return {}
	const ch = channelId || governanceChannelIdFromState(stateJson)
	const response = await fetch(
		`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/permissions?pubKeyHash=${encodeURIComponent(pubKeyHash)}&channelId=${encodeURIComponent(ch)}`,
		{ credentials: 'include' },
	)
	if (!response.ok) return {}
	return response.json()
}

/**
 * @typedef {{
 *   isMember: boolean,
 *   canManageArchive: boolean,
 *   canViewAudit: boolean,
 *   canManageRoles: boolean,
 *   canManageChannelPerms: boolean,
 *   canModerateMembers: boolean,
 *   canUnbanMembers: boolean,
 *   canInviteMembers: boolean,
 *   canEditGroupSettings: boolean,
 *   canEditGroupMeta: boolean,
 *   canEditDiscovery: boolean,
 *   canDeleteGroup: boolean,
 *   canKeyRotate: boolean,
 *   canFedTuning: boolean,
 *   canOwnerSuccession: boolean,
 *   showGovernancePanel: boolean,
 * }} ViewerSettingsCapabilities
 */

/**
 * 群设置页门控：本机 replica 区 vs DAG 治理区。
 * @param {object} stateJson `/groups/:id/state`
 * @param {string} groupId 群 ID
 * @returns {Promise<ViewerSettingsCapabilities>} 设置页各区块可见性
 */
export async function resolveViewerSettingsCapabilities(stateJson, groupId) {
	const isMember = !!stateJson?.viewerMemberPubKeyHash
	if (!isMember) {
		const hasLocalReplica = stateJson?.hasLocalReplica === true
		return {
			isMember: false,
			canManageArchive: hasLocalReplica,
			canViewAudit: false,
			canManageRoles: false,
			canManageChannelPerms: false,
			canModerateMembers: false,
			canUnbanMembers: false,
			canInviteMembers: false,
			canEditGroupSettings: false,
			canEditGroupMeta: false,
			canEditDiscovery: false,
			canDeleteGroup: false,
			canKeyRotate: false,
			canFedTuning: false,
			canOwnerSuccession: false,
			showGovernancePanel: false,
		}
	}

	const permissions = await fetchViewerChannelPermissions(stateJson, groupId)
	const canEditGroupSettings = permissions.ADMIN === true || permissions.MANAGE_ADMINS === true
	const canEditGroupMeta = permissions.MANAGE_CHANNELS === true
	const canEditDiscovery = permissions.ADMIN === true || permissions.MANAGE_CHANNELS === true
	const memberCount = Number(stateJson?.memberCount)
		|| (Array.isArray(stateJson?.members) ? stateJson.members.length : 0)
	const canKeyRotate = memberCount === 2 || permissions.ADMIN === true
	const canFedTuning = canEditGroupSettings
	const canOwnerSuccession = permissions.ADMIN === true
	return {
		isMember: true,
		canManageArchive: true,
		canViewAudit: permissions.ADMIN === true,
		canManageRoles: permissions.MANAGE_ROLES === true,
		canManageChannelPerms: permissions.MANAGE_CHANNELS === true,
		canModerateMembers: permissions.KICK_MEMBERS === true || permissions.BAN_MEMBERS === true,
		canUnbanMembers: permissions.BAN_MEMBERS === true,
		canInviteMembers: permissions.INVITE_MEMBERS === true || canEditGroupSettings,
		canEditGroupSettings,
		canEditGroupMeta,
		canEditDiscovery,
		canDeleteGroup: canEditGroupSettings,
		canKeyRotate,
		canFedTuning,
		canOwnerSuccession,
		showGovernancePanel: canEditGroupSettings || canKeyRotate || canOwnerSuccession || canFedTuning,
	}
}

/**
 * @param {object} stateJson state
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<boolean>} 是否可添加/撤销自己的 reaction
 */
export async function viewerCanAddReactions(stateJson, groupId, channelId) {
	const permissions = await fetchViewerChannelPermissions(stateJson, groupId, channelId)
	return permissions.ADD_REACTIONS === true
}

/**
 * @param {object} stateJson state
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<boolean>} 是否可代删他人 reaction
 */
export async function viewerCanManageMessages(stateJson, groupId, channelId) {
	const permissions = await fetchViewerChannelPermissions(stateJson, groupId, channelId)
	return permissions.MANAGE_MESSAGES === true
}

/**
 * @param {object} stateJson state
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<boolean>} 是否可置顶消息
 */
export async function viewerCanPinMessages(stateJson, groupId, channelId) {
	const permissions = await fetchViewerChannelPermissions(stateJson, groupId, channelId)
	return permissions.PIN_MESSAGES === true
}

/**
 * @param {object} stateJson state
 * @param {string} groupId 群
 * @returns {Promise<boolean>} 当前查看者是否具备发起继任投票（管理员）资格
 */
export async function viewerCanOwnerSuccession(stateJson, groupId) {
	const permissions = await fetchViewerChannelPermissions(stateJson, groupId)
	return permissions.ADMIN === true
}
