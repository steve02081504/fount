import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'
import { loadTrustedAuthorHashes, saveTrustedAuthorHashes } from '../trustedAuthors.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTrustedAuthorsRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/trusted-authors`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ hashes: loadTrustedAuthorHashes(username) })
	})
	router.put(`${CHAT_API_PREFIX}/trusted-authors`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const hashes = saveTrustedAuthorHashes(username, req.body.hashes)
		res.status(200).json({ hashes })
	})
}
