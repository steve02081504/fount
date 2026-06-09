/**
 * 【文件】group/routes/middleware.mjs
 * 【职责】群路由共享鉴权 helper：成员解析、频道存在与频道权限校验。
 * 【原理】resolveGroupMember 统一 getUser → getState → memberKey；ensure* 系列供路由早退。
 * 【关联】channels.mjs、governance.mjs、groupSync.mjs、dag.mjs、membership.mjs。
 */
import { getUserByReq } from '../../../../../../../server/auth.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { canInChannel, resolveActiveMemberKeyForLocalUser } from '../access.mjs'

/**
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {number} status HTTP 状态码
 * @param {string} error 错误信息
 * @returns {false} 恒为 false，便于 `if (!fn()) return` 早退
 */
export function denyJson(res, status, error) {
	res.status(status).json({ error })
	return false
}

/**
 * 解析已登录成员与物化群状态；非成员时写 403 并返回 null。
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {string} groupId 群 ID
 * @returns {Promise<{ username: string, state: object, memberKey: string, member: object } | null>} 成员上下文或 null
 */
export async function resolveGroupMember(req, res, groupId) {
	const { username } = await getUserByReq(req)
	const { state } = await getState(username, groupId)
	const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
	if (!memberKey) {
		res.status(403).json({ error: 'Not a member' })
		return null
	}
	return { username, state, memberKey, member: state.members[memberKey] }
}

/**
 * 将 group 成员上下文挂载到 req.groupContext。
 * @param {{ groupParam?: number }} [options] 参数索引配置
 * @returns {import('npm:express').RequestHandler} 中间件
 */
export function requireGroupMember(options = {}) {
	const groupParam = Number.isInteger(options.groupParam) ? options.groupParam : 0
	return async (req, res, next) => {
		const groupId = req.params[groupParam]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		req.groupContext = { ...membership, groupId }
		next()
	}
}

/**
 * 将 group + channel 上下文挂载到 req.groupContext，并可选执行权限检查。
 * @param {{ groupParam?: number, channelParam?: number, permission?: string, error?: string, sendText?: boolean }} [options] 参数与权限配置
 * @returns {import('npm:express').RequestHandler} 中间件
 */
export function requireGroupChannel(options = {}) {
	const groupParam = Number.isInteger(options.groupParam) ? options.groupParam : 0
	const channelParam = Number.isInteger(options.channelParam) ? options.channelParam : 1
	const permission = options.permission || null
	return async (req, res, next) => {
		const groupId = req.params[groupParam]
		const channelId = req.params[channelParam]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { state, member } = membership
		if (!ensureChannel(res, state, channelId)) return
		if (permission) {
			const ok = options.sendText
				? ensureCanInChannelSend(res, state, member, permission, channelId, options.error)
				: ensureCanInChannel(res, state, member, permission, channelId, options.error)
			if (!ok) return
		}
		req.groupContext = { ...membership, groupId, channelId }
		next()
	}
}

/**
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {boolean} 频道存在则为 true
 */
export function ensureChannel(res, state, channelId) {
	if (state.channels[channelId]) return true
	return denyJson(res, 404, 'Channel not found')
}

/**
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {object} state 物化群状态
 * @param {object} member 成员
 * @param {string} permission 权限名
 * @param {string} channelId 频道 ID
 * @param {string} [error] 403 文案
 * @returns {boolean} 有权限则为 true
 */
export function ensureCanInChannel(res, state, member, permission, channelId, error) {
	if (canInChannel(state, member, permission, channelId)) return true
	return denyJson(res, 403, error || `${permission} denied`)
}

/**
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {object} state 物化群状态
 * @param {object} member 成员
 * @param {string} permission 权限名
 * @param {string} channelId 频道 ID
 * @param {string} [error] 403 纯文本
 * @returns {boolean} 有权限则为 true
 */
export function ensureCanInChannelSend(res, state, member, permission, channelId, error) {
	if (canInChannel(state, member, permission, channelId)) return true
	res.status(403).send(error || `${permission} denied`)
	return false
}

