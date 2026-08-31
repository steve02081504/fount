/**
 * 【文件】public/src/endpoints/groupCore.mjs
 * 【职责】群生命周期与元数据 API：建群、列表、入退群、initial-data、成员分页、邀请、文件系统、审计日志。
 * 【原理】经 groupFetch / chatFetch 访问 groups/:id 与 sessions 子路径。
 * 【数据结构】groupId、分页游标、invite 载荷、文件 folder 更新体。
 * 【关联】groupClient.mjs；groupModals、groupSettings、Hub 群切换。
 */
import { CHAT_LEAVE_BATCH_MAX } from '../lib/batchLimits.mjs'

import { chatFetch, groupFetch, groupPath } from './groupClient.mjs'

/**
 * 拉取群 initial-data（聊天配置快照）。
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} initial-data 载荷
 */
export async function getGroupChatConfig(groupId) {
	return groupFetch(groupPath(groupId, 'initial-data'), { method: 'GET' })
}

/**
 * 创建新群组。
 * @param {string} name 群组名称
 * @param {string} [description] 描述
 * @param {{ joinPolicy?: string }} [options] 建群选项
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} 新群 ID 与默认频道
 */
export async function createGroup(name, description, options = {}) {
	const data = await groupFetch('', {
		method: 'POST',
		json: {
			name,
			description,
			joinPolicy: options.joinPolicy,
		},
	})
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
		unreadCount: Number(row.unreadCount) || 0,
		channelUnread: row.channelUnread || {},
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
	await groupFetch(groupPath(groupId, 'join'), {
		method: 'POST',
		json: {
			inviteCode,
			pow,
			...dmLinkProof,
			roomSecret: fedBootstrap?.roomSecret,
			signalingAppId: fedBootstrap?.signalingAppId,
			introducerPubKeyHash: fedBootstrap?.introducerPubKeyHash,
			introducerNodeHash: fedBootstrap?.introducerNodeHash,
		},
	})
}

/**
 * 退出一个或多个群（`member_leave` + 移除本机群数据；单群也传长度为 1 的数组）。
 * @param {string | string[]} groupIds 群 ID 或列表
 * @returns {Promise<{ ok: string[], failed: { groupId: string, error: string }[] }>} 成功与失败列表
 */
export async function leaveGroups(groupIds) {
	const ids = Array.isArray(groupIds) ? groupIds : [groupIds]
	/** @type {string[]} */
	const ok = []
	/** @type {{ groupId: string, error: string }[]} */
	const failed = []
	for (let offset = 0; offset < ids.length; offset += CHAT_LEAVE_BATCH_MAX) {
		const chunk = ids.slice(offset, offset + CHAT_LEAVE_BATCH_MAX)
		const part = await groupFetch('leave', { method: 'POST', json: { groupIds: chunk } })
		ok.push(...part.ok || [])
		failed.push(...part.failed || [])
	}
	return { ok, failed }
}

/**
 * 签发群组邀请票据。
 * @param {string} groupId 群 ID
 * @param {{ ttlMs?: number }} [options] 票据有效期等选项
 * @returns {Promise<{ code: string, expiresAt: number, clipboardText?: string }>} 邀请码、过期时间与剪贴板全文
 */
export async function createGroupInvite(groupId, options = {}) {
	const data = await groupFetch(groupPath(groupId, 'invite-ticket'), { method: 'POST', json: { ttlMs: options.ttlMs } })
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
	const { roles: myRoles, ...viewerRest } = viewer
	return {
		...meta,
		...viewerRest,
		...federation,
		viewerMemberPubKeyHash: viewer.memberKey ?? null,
		viewerEntityHash: viewer.entityHash ?? null,
		myRoles: myRoles ?? [],
	}
}

/**
 * 动态申请入群 PoW challenge（仅 pow 群返回；本地无 replica 时经联邦取当前稳定锚 + 难度）。
 * @param {string} groupId 群 ID
 * @param {{ introducerNodeHash?: string }} [options] 优先定向的引入者节点
 * @returns {Promise<{ anchors: string[], powFloorBits: number, powEpochMs: number, roomSecret?: string, signalingAppId?: string, responderNodeHash?: string }>} challenge
 */
export async function getPowChallenge(groupId, options = {}) {
	return groupFetch(
		`${groupPath(groupId, 'pow-challenge')}${options.introducerNodeHash
			? `?introducerNodeHash=${encodeURIComponent(options.introducerNodeHash)}`
			: ''}`,
		{ method: 'GET' },
	)
}

/**
 * 分页拉取群审计日志（需 ADMIN）。
 * @param {string} groupId 群 ID
 * @param {{ before?: string, offset?: number, limit?: number, types?: string[] }} [options] 游标/偏移与类型过滤
 * @returns {Promise<{ entries: object[], hasMore: boolean, total: number, types: string[] }>} 审计条目、分页标记、总数与可用类型列表
 */
export async function fetchGroupAuditLog(groupId, options = {}) {
	const params = new URLSearchParams()
	if (options.before) params.set('before', options.before)
	if (options.offset !== undefined) params.set('offset', String(options.offset))
	if (options.limit !== undefined) params.set('limit', String(options.limit))
	if (options.types?.length) params.set('types', options.types.join(','))
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
 * @param {number} pageIndex 页码（从 0 起）
 * @returns {Promise<{ members: object[], membersRoot: string|null, membersPagesCount: number }>} 成员页数据
 */
export async function getMembersPage(groupId, pageIndex) {
	const data = await groupFetch(groupPath(groupId, 'members', 'page', pageIndex), { method: 'GET' })
	return {
		members: data.members,
		membersRoot: data.membersRoot ?? null,
		membersPagesCount: Number(data.membersPagesCount) || 1,
	}
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
 * 创建好友绑定群（角色私聊 / 强制新建）。
 * @param {object} body POST body（含 friendBinding、可选 forceNew）；`friendBinding` 为 `{ entityHash }` 或 `{ charname }`
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<{ groupId: string, friendBinding?: object, reused?: boolean }>} 新群（或复用）与规范化绑定
 */
export async function createFriendGroup(body, signal) {
	return groupFetch('', { method: 'POST', json: body, signal })
}

/**
 * 列出群上已挂载的角色 part 名。
 * @param {string} groupId 群 ID
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<string[]>} charname 列表
 */
export async function listGroupChars(groupId, signal) {
	return groupFetch(groupPath(groupId, 'chars'), { method: 'GET', signal })
}

/**
 * 向群添加角色 part。
 * @param {string} groupId 群 ID
 * @param {{ charname: string, deferGreeting?: boolean }} body 请求体
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<any>} 响应
 */
export async function addGroupChar(groupId, body, signal) {
	return groupFetch(groupPath(groupId, 'char'), { method: 'POST', json: body, signal })
}

/**
 * 从群移除角色 part。
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @returns {Promise<void>}
 */
export async function removeGroupChar(groupId, charname) {
	await groupFetch(groupPath(groupId, 'char', charname), { method: 'DELETE' })
}

/**
 * 设置角色在群上的回复频率。
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {number} frequency 0–1
 * @returns {Promise<void>}
 */
export async function setGroupCharFrequency(groupId, charname, frequency) {
	await groupFetch(groupPath(groupId, 'char', charname, 'frequency'), {
		method: 'PUT',
		json: { frequency },
	})
}

/**
 * 设置群 persona part。
 * @param {string} groupId 群 ID
 * @param {string|null} personaname persona 名；空串/`null` 清除
 * @returns {Promise<any>} 响应
 */
export async function setGroupPersona(groupId, personaname) {
	return groupFetch(groupPath(groupId, 'persona'), {
		method: 'PUT',
		json: { personaname },
	})
}

/**
 * 设置频道绑定的 world part。
 * @param {string} groupId 群 ID
 * @param {string|null} worldname world 名；空串/`null` 清除
 * @param {string} [channelId] 频道 ID
 * @returns {Promise<any>} 响应
 */
export async function setGroupWorld(groupId, worldname, channelId = 'default') {
	return groupFetch(groupPath(groupId, 'world'), {
		method: 'PUT',
		json: { worldname, channelId },
	})
}

/**
 * 列出群上已挂载的插件 part 名。
 * @param {string} groupId 群 ID
 * @returns {Promise<string[]>} pluginname 列表
 */
export async function listGroupPlugins(groupId) {
	const plugins = await groupFetch(groupPath(groupId, 'plugins'), { method: 'GET' })
	return Array.isArray(plugins) ? plugins : []
}

/**
 * 向群添加插件 part。
 * @param {string} groupId 群 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<any>} 响应
 */
export async function addGroupPlugin(groupId, pluginname) {
	return groupFetch(groupPath(groupId, 'plugin'), {
		method: 'POST',
		json: { pluginname },
	})
}

/**
 * 从群移除插件 part。
 * @param {string} groupId 群 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<void>}
 */
export async function removeGroupPlugin(groupId, pluginname) {
	await groupFetch(groupPath(groupId, 'plugin', pluginname), { method: 'DELETE' })
}

/**
 * 更新群元数据（名称、描述）。
 * @param {string} groupId 群 ID
 * @param {{ name: string, description: string }} body 元数据
 * @returns {Promise<void>}
 */
export async function putGroupMeta(groupId, body) {
	await groupFetch(groupPath(groupId, 'meta'), { method: 'PUT', json: body })
}

/**
 * 更新群设置（联邦调优、限流、存储等参数）。
 * @param {string} groupId 群 ID
 * @param {object} body 设置对象
 * @returns {Promise<void>}
 */
export async function putGroupSettings(groupId, body) {
	await groupFetch(groupPath(groupId, 'settings'), { method: 'PUT', json: body })
}

/**
 * 删除整个群组。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function removeGroup(groupId) {
	await groupFetch(groupPath(groupId), { method: 'DELETE' })
}

/**
 * 删除一个会话（私聊群的消息记录，永久移除）。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function deleteSession(groupId) {
	await chatFetch(`/sessions/${encodeURIComponent(groupId)}`, { method: 'DELETE' })
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

/**
 * 查询当前观众在群/频道上的权限位。
 * @param {string} groupId 群 ID
 * @param {string} pubKeyHash 观众成员公钥哈希
 * @param {string} channelId 频道 ID
 * @returns {Promise<Record<string, boolean>>} 权限表
 */
export async function getViewerPermissions(groupId, pubKeyHash, channelId) {
	const params = new URLSearchParams({ pubKeyHash, channelId })
	return groupFetch(`${groupPath(groupId, 'permissions')}?${params}`, { method: 'GET' })
}

/**
 * 拉取当前 DAG 分叉 tips（治理/横幅用）。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ tips: string[], governanceFork: boolean, consensusBranchTip?: string, tipConsensusScores?: Record<string, number> }>} tips 与治理分叉标记
 */
export async function getDagTips(groupId) {
	return groupFetch(groupPath(groupId, 'dag', 'tips'), { method: 'GET' })
}
