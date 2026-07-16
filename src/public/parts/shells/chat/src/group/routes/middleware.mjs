/**
 * 【文件】group/routes/middleware.mjs
 * 【职责】群路由共享鉴权 helper：成员解析、频道存在与频道权限校验。
 * 【原理】resolveGroupMember 统一 getUser → getState → memberKey；ensure* 系列供路由早退。
 * 【关联】channels.mjs、governance.mjs、groupSync.mjs、dag.mjs、membership.mjs。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { getUserByReq } from '../../../../../../../server/auth/index.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { canInChannel, resolveActiveMemberKeyForLocalUser } from '../access.mjs'
import { loadGroupShunState } from '../groupShunState.mjs'

/**
 * 解析已登录成员与物化群状态；非成员时 throw httpError(403)。
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {import('npm:express').Response} _res HTTP 响应（保留签名兼容）
 * @param {string} groupId 群 ID
 * @param {{ allowSuspectedRemoved?: boolean }} [options] 是否放行疑似出局（catchup/探测）
 * @returns {Promise<{ username: string, state: object, memberKey: string, member: object }>} 成员上下文
 */
export async function resolveGroupMember(req, _res, groupId, options = {}) {
	const { username } = await getUserByReq(req)
	const { state } = await getState(username, groupId)
	const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
	if (!memberKey)
		throw httpError(403, 'Not a member')
	if (!options.allowSuspectedRemoved) {
		const shunState = await loadGroupShunState(username, groupId)
		if (shunState.suspectedRemoved)
			throw httpError(403, 'Not a member', { json: { error: 'Not a member', suspectedRemoved: true } })
	}
	return { username, state, memberKey, member: state.members[memberKey] }
}

/**
 * 将 group 成员上下文挂载到 req.groupContext。
 * @param {{ groupParam?: number }} [options] 参数索引配置
 * @returns {import('npm:express').RequestHandler} 中间件
 */
export function requireGroupMember(options = {}) {
	const groupParam = options.groupParam ?? 'groupId'
	const allowSuspectedRemoved = !!options.allowSuspectedRemoved
	return async (req, res, next) => {
		const groupId = req.params[groupParam]
		req.groupContext = { ...await resolveGroupMember(req, res, groupId, { allowSuspectedRemoved }), groupId }
		next()
	}
}

/**
 * 将 group + channel 上下文挂载到 req.groupContext，并可选执行权限检查。
 * @param {{ groupParam?: number, channelParam?: number, permission?: string, error?: string, sendText?: boolean }} [options] 参数与权限配置
 * @returns {import('npm:express').RequestHandler} 中间件
 */
export function requireGroupChannel(options = {}) {
	const groupParam = options.groupParam ?? 'groupId'
	const channelParam = options.channelParam ?? 'channelId'
	const permission = options.permission || null
	return async (req, res, next) => {
		const groupId = req.params[groupParam]
		const channelId = req.params[channelParam]
		const membership = await resolveGroupMember(req, res, groupId)
		const { state, member } = membership
		ensureChannel(state, channelId)
		if (permission) 
			if (options.sendText)
				ensureCanInChannelSend(state, member, permission, channelId, options.error)
			else
				ensureCanInChannel(state, member, permission, channelId, options.error)
		
		req.groupContext = { ...membership, groupId, channelId }
		next()
	}
}

/**
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function ensureChannel(state, channelId) {
	if (state.channels[channelId]) return
	throw httpError(404, 'Channel not found')
}

/**
 * @param {object} state 物化群状态
 * @param {object} member 成员
 * @param {string} permission 权限名
 * @param {string} channelId 频道 ID
 * @param {string} [error] 403 文案
 * @returns {void}
 */
export function ensureCanInChannel(state, member, permission, channelId, error) {
	if (canInChannel(state, member, permission, channelId)) return
	throw httpError(403, error || `${permission} denied`)
}

/**
 * @param {object} state 物化群状态
 * @param {object} member 成员
 * @param {string} permission 权限名
 * @param {string} channelId 频道 ID
 * @param {string} [error] 403 文案
 * @returns {void}
 */
export function ensureCanInChannelSend(state, member, permission, channelId, error) {
	if (canInChannel(state, member, permission, channelId)) return
	throw httpError(403, error || `${permission} denied`)
}

/**
 * 置顶/取消置顶共用权限闸门：`PIN_MESSAGES` 或 `MANAGE_MESSAGES`（ADMIN 经 canInChannel 自动蕴含）。
 * @param {object} state 物化群状态
 * @param {object} member 成员
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function ensurePinPermission(state, member, channelId) {
	if (canInChannel(state, member, PERMISSIONS.PIN_MESSAGES, channelId)
		|| canInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId))
		return
	throw httpError(403, 'PIN_MESSAGES or MANAGE_MESSAGES required')
}
