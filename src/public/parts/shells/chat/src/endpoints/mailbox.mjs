import { pubKeyHash } from '../../../../../../scripts/p2p/crypto.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { getFederationSettings } from '../chat/federation/config.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerMailboxRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/mailbox/summary`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { countMailboxPendingForRecipient } = await import('../../../../../../scripts/p2p/mailbox/store.mjs')
		const fed = await getFederationSettings(username)
		const activePubKeyHex = String(fed?.activePubKeyHex || '').trim()
		if (!activePubKeyHex)
			return res.status(200).json({ pending: 0 })
		const pending = await countMailboxPendingForRecipient(pubKeyHash(activePubKeyHex))
		res.status(200).json({ pending })
	})
}
