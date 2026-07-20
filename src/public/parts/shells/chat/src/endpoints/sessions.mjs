import { access } from 'node:fs/promises'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { groupDir } from '../chat/lib/paths.mjs'
import { deleteGroup } from '../chat/session/groupLifecycle.mjs'
import { groupMetadatas } from '../chat/session/wsLifecycle.mjs'

/**
 * 注册本机会话路由（私聊/本地 replica 删除）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSessionRoutes(router) {
	router.delete('/api/parts/shells\\:chat/sessions/:groupId', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const owner = groupMetadatas.get(groupId)?.username
		if (owner && owner !== username)
			throw httpError(403, 'Permission denied')
		try {
			await access(groupDir(username, groupId))
		}
		catch {
			throw httpError(404, 'Group not found')
		}
		const [result] = await deleteGroup([groupId], username)
		if (result?.error)
			throw httpError(500, result.error)
		res.status(200).json({})
	})
}
