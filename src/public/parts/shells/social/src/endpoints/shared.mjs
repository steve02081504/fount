import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { getUserByReq } from '../../../../../../server/auth/index.mjs'

/**
 * @param {import('npm:express').Request['params']} params 路由 params
 * @returns {string} 小写 entityHash
 */
export function routeEntityHash(params) {
	const hash = String(params.entityHash).toLowerCase()
	if (!isEntityHash128(hash))
		throw httpError(400, 'invalid entityHash')
	return hash
}

/**
 * 从请求解析会话用户并以 operator 身份取得 SocialClient（HTTP 永不接受 acting 覆盖）。
 * @param {import('npm:express').Request} req Express 请求
 * @returns {Promise<{ username: string, client: object }>} 用户名与 client
 */
export async function socialClientFromReq(req) {
	const { username } = getUserByReq(req)
	const { getSocialClient } = await import('../api/client/index.mjs')
	return { username, client: await getSocialClient(username) }
}

/**
 * SocialClient JSON 路由薄包装：解析 client → 跑 handler → 200 JSON。
 * @param {(req: import('npm:express').Request, ctx: { username: string, client: object }) => Promise<unknown>} handler 业务
 * @returns {import('npm:express').RequestHandler} Express 处理器
 */
export function socialJson(handler) {
	return async (req, res) => {
		const ctx = await socialClientFromReq(req)
		res.status(200).json(await handler(req, ctx))
	}
}
