import { pubKeyHash } from 'npm:@steve02081504/fount-p2p/crypto'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { getFederationSettings } from '../chat/federation/config.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerMailboxRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/mailbox/summary`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { countMailboxPendingForRecipient } = await import('npm:@steve02081504/fount-p2p/mailbox/store')
		const fed = await getFederationSettings(username)
		const activePubKeyHex = String(fed?.activePubKeyHex || '').trim()
		if (!activePubKeyHex)
			return res.status(200).json({ pendingCount: 0 })
		const pendingCount = await countMailboxPendingForRecipient(pubKeyHash(activePubKeyHex))
		res.status(200).json({ pendingCount })
	})
}
