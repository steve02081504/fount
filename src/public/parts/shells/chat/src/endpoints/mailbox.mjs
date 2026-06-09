import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerMailboxRoutes(router) {
	router.get('/api/parts/shells\\:chat/mailbox/summary', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { countMailboxPending } = await import('../../../../../../scripts/p2p/mailbox/store.mjs')
		res.status(200).json({ pending: await countMailboxPending(username) })
	})
}
