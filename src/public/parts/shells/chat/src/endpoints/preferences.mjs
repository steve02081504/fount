import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

import { chatClientFromReq } from './shared.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerPrefsRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/bookmarks`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.bookmarks.list())
	})
	router.put(`${CHAT_API_PREFIX}/bookmarks`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.bookmarks.set(req.body.entries || []))
	})

	router.get(`${CHAT_API_PREFIX}/group-folders`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.groupFolders.list())
	})
	router.put(`${CHAT_API_PREFIX}/group-folders`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.groupFolders.set(req.body.folders || []))
	})

	router.get(`${CHAT_API_PREFIX}/custom-emojis`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.emojis.list())
	})
	router.put(`${CHAT_API_PREFIX}/custom-emojis`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.emojis.set(req.body.entries || []))
	})
	router.post(`${CHAT_API_PREFIX}/custom-emojis/save`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		try {
			res.status(200).json(await client.emojis.save(req.body || {}))
		}
		catch (error) {
			throw httpError(400, error?.message || 'save custom emoji failed')
		}
	})

	router.get(`${CHAT_API_PREFIX}/emoji-usage/frequent`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		const limit = Math.min(64, Math.max(1, Number.parseInt(String(req.query?.limit ?? '32'), 10) || 32))
		res.status(200).json({ entries: await client.emojis.frequent(limit) })
	})

	router.get(`${CHAT_API_PREFIX}/reputation`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({ reputation: await client.reputation() })
	})

	router.get(`${CHAT_API_PREFIX}/care`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({ cared: await client.care.list() })
	})
	router.put(`${CHAT_API_PREFIX}/care`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({
			cared: await client.care.set(req.body.targetEntityHash, req.body.cared !== false),
		})
	})

	router.get(`${CHAT_API_PREFIX}/aliases`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.aliases.list())
	})
	router.put(`${CHAT_API_PREFIX}/aliases`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.aliases.set(req.body || {}))
	})

	router.get(`${CHAT_API_PREFIX}/notify-prefs`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({ prefs: await client.notifications.get() })
	})
	router.put(`${CHAT_API_PREFIX}/notify-prefs`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({ prefs: await client.notifications.set(req.body.prefs || {}) })
	})
}
