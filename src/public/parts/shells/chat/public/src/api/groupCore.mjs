/**
 * 【文件】public/src/api/groupCore.mjs
 * 【职责】群生命周期与元数据 API：建群、列表、入退群、initial-data、成员分页、邀请、文件系统、审计日志。
 * 【原理】全部经 groupRequest/groupFetch 访问 groups/:id 下 REST 子路径。
 * 【数据结构】groupId、分页游标、invite 载荷、文件 folder 更新体。
 * 【关联】groupClient.mjs；groupModals、groupSettings、Hub 群切换。
 */
import { CHAT_LEAVE_BATCH_MAX } from '../lib/batchLimits.mjs'

import { groupFetch, groupPath, groupRequest } from './groupClient.mjs'

/**
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} initial-data 载荷
 */
export async function getGroupChatConfig(groupId) {
	return groupRequest(groupId, 'initial-data', 'GET')
}

/**
 * 创建新群组。
 * @param {string} name 群组名称
 * @param {string} [description] 描述
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} 新群 ID 与默认频道
 */
export async function createGroup(name, description) {
	const data = await groupFetch('', { method: 'POST', json: { name, description } })
	return { groupId: data.groupId, defaultChannelId: data.defaultChannelId || 'default' }
}

/**
 * 拉取当前用户已加入的联邦群 / DM 列表。
 * @returns {Promise<object[]>} 群组摘要列表
 */
export async function getGroupList() {
	const data = await groupFetch('', { method: 'GET' })
	return data.map(row => ({
		groupId: row.groupId,
		name: row.name,
		description: row.description ?? '',
		avatar: row.avatar,
		defaultChannelId: row.defaultChannelId,
		memberCount: row.memberCount,
		channelCount: row.channelCount,
		lastMessageTime: row.lastMessageTime,
		friendBinding: row.friendBinding ?? null,
	}))
}

/**
 * 加入群组（可选邀请码或 DM 引荐证明）。
 * @param {string} groupId 群 ID
 * @param {string | null} [inviteCode] 邀请码
 * @param {{ dmIntroNonce?: string, dmIntroSignatureHex?: string, introducerPubKeyHash?: string }} [dmLinkProof] DM 深链引荐字段
 * @param {{ challenge: string, nonce: string } | null} [pow] PoW 入群证明
 * @param {{ signalingAppId?: string, roomSecret?: string, introducerPubKeyHash?: string, introducerNodeHash?: string } | null} [fedBootstrap] 首次联邦房间凭证 口令与邀请人
 * @returns {Promise<void>}
 */
export async function joinGroup(groupId, inviteCode = null, dmLinkProof = null, pow = null, fedBootstrap = null) {
	const json = {
		inviteCode: inviteCode || undefined,
		pow: pow || undefined,
		...dmLinkProof || {},
	}
	if (fedBootstrap?.roomSecret) {
		json.roomSecret = fedBootstrap.roomSecret
		if (fedBootstrap.signalingAppId) json.signalingAppId = fedBootstrap.signalingAppId
	}
	if (fedBootstrap?.introducerPubKeyHash)
		json.introducerPubKeyHash = fedBootstrap.introducerPubKeyHash
	if (fedBootstrap?.introducerNodeHash)
		json.introducerNodeHash = fedBootstrap.introducerNodeHash
	await groupFetch(groupPath(groupId, 'join'), { method: 'POST', json })
}

/**
 * 退出一个或多个群（`member_leave` + 移除本机群数据；单群也传长度为 1 的数组）。
 * @param {string | string[]} groupIds 群 ID 或列表
 * @returns {Promise<{ ok: string[], failed: { groupId: string, error: string }[] }>} 成功与失败列表
 */
export async function leaveGroups(groupIds) {
	const ids = [...new Set(
		(Array.isArray(groupIds) ? groupIds : [groupIds]).map(id => String(id ?? '').trim()).filter(Boolean),
	)]
	/** @type {string[]} */
	const ok = []
	/** @type {{ groupId: string, error: string }[]} */
	const failed = []
	for (let i = 0; i < ids.length; i += CHAT_LEAVE_BATCH_MAX) {
		const chunk = ids.slice(i, i + CHAT_LEAVE_BATCH_MAX)
		const part = await groupFetch('leave', { method: 'POST', json: { groupIds: chunk } })
		ok.push(...part.ok || [])
		failed.push(...part.failed || [])
	}
	return { ok, failed }
}

/**
 * 签发群组邀请票据。
 * @param {string} groupId 群 ID
 * @param {{ ttlMs?: number }} [opts] 票据有效期等选项
 * @returns {Promise<{ code: string, expiresAt: number, clipboardText?: string }>} 邀请码、过期时间与剪贴板全文
 */
export async function createGroupInvite(groupId, opts = {}) {
	const data = await groupFetch(groupPath(groupId, 'invite-ticket'), { method: 'POST', json: { ttlMs: opts.ttlMs } })
	return { code: data.code, expiresAt: data.expiresAt, clipboardText: data.clipboardText }
}

/**
 * 拉取群完整状态快照。
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 群状态对象
 */
export async function getGroupState(groupId) {
	const data = await groupFetch(groupPath(groupId, 'state'), { method: 'GET' })
	const { meta = {}, viewer = {}, federation = {} } = data
	return {
		...meta,
		...viewer,
		...federation,
		viewerMemberPubKeyHash: viewer.memberKey ?? null,
		viewerEntityHash: viewer.entityHash ?? null,
		myRoles: viewer.roles ?? [],
	}
}

/**
 * 分页拉取群审计日志（需 ADMIN）。
 * @param {string} groupId 群 ID
 * @param {{ before?: string, offset?: number, limit?: number, types?: string[] }} [opts] 游标/偏移与类型过滤
 * @returns {Promise<{ entries: object[], hasMore: boolean, total: number, types: string[] }>} 审计条目、分页标记、总数与可用类型列表
 */
export async function fetchGroupAuditLog(groupId, opts = {}) {
	const params = new URLSearchParams()
	if (opts.before) params.set('before', opts.before)
	if (opts.offset !== undefined) params.set('offset', String(opts.offset))
	if (opts.limit !== undefined) params.set('limit', String(opts.limit))
	if (opts.types?.length) params.set('types', opts.types.join(','))
	const query = params.toString()
	const data = await groupFetch(
		`${groupPath(groupId, 'audit-log')}${query ? `?${query}` : ''}`,
		{ method: 'GET' },
	)
	return {
		entries: Array.isArray(data.entries) ? data.entries : [],
		hasMore: !!data.hasMore,
		total: Number(data.total) || 0,
		types: Array.isArray(data.types) ? data.types : [],
	}
}

/**
 * 分页拉取成员列表。
 * @param {string} groupId 群 ID
 * @param {number} pageIdx 页码（从 0 起）
 * @returns {Promise<{ members: object[], membersRoot: string|null, membersPagesCount: number }>} 成员页数据
 */
export async function getMembersPage(groupId, pageIdx) {
	const data = await groupFetch(groupPath(groupId, 'members', 'page', Math.max(0, pageIdx)), { method: 'GET' })
	return {
		members: data.members,
		membersRoot: data.membersRoot ?? null,
		membersPagesCount: Number(data.membersPagesCount) || 1,
	}
}

/**
 * 创建或更新群文件系统文件夹。
 * @param {string} groupId 群 ID
 * @param {object} body 文件夹元数据
 * @returns {Promise<object>} 产生的链上事件
 */
export async function updateFileSystemFolder(groupId, body) {
	const data = await groupFetch(groupPath(groupId, 'file-system'), { method: 'POST', json: body })
	return data.event
}

/**
 * 删除群内文件。
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<void>}
 */
export async function deleteGroupFile(groupId, fileId) {
	await groupFetch(groupPath(groupId, 'files', fileId), { method: 'DELETE' })
}

/**
 * 获取流媒体频道嵌入鉴权。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ token: string, embedUrl: string, expiresAt: number, sessionId: string }>} 流媒体会话凭证
 */
export async function getStreamingChannelAuth(groupId, channelId) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'streaming-auth'), {
		method: 'POST',
		json: {},
	})
	return {
		token: data.token,
		embedUrl: data.embedUrl,
		expiresAt: data.expiresAt,
		sessionId: data.sessionId,
	}
}
