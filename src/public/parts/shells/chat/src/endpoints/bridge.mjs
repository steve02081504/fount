import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { bindBridgeIdentity } from '../chat/bridge/identity.mjs'
import { resolveChatRecipient } from '../chat/lib/recipient.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerBridgeRoutes(router) {
	router.put(`${CHAT_API_PREFIX}/bridge/identity-bind`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { platform, platformUserId, entityHash } = req.body || {}
		if (!platform || platformUserId == null || !entityHash)
			throw httpError(400, 'platform, platformUserId, entityHash required')

		await resolveChatRecipient(username, entityHash)
		await bindBridgeIdentity(username, {
			platform: String(platform),
			platformUserId,
			entityHash: String(entityHash),
			displayName: req.body?.displayName,
		})
		res.status(200).json({})
	})
}
