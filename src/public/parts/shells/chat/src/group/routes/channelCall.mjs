/**
 * 【文件】group/routes/channelCall.mjs
 * 【职责】文本/流媒体频道通话状态查询。
 */
import { getCallStatus } from '../../chat/call/session.mjs'

import { requireGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权
 * @returns {void}
 */
export function registerChannelCallRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/call-status`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupId } = req.groupContext
		const { channelId } = req.params
		res.status(200).json(getCallStatus(groupId, channelId))
	})
}
