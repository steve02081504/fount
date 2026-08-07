import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { isPackAvailableToUser } from '../emojiAvailability.mjs'
import {
	addPackToCollection,
	listCollection,
	loadEmojiUsage,
	loadUsagePayload,
	recordEmojiUsage,
	removePackFromCollection,
} from '../emojiUsage.mjs'
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
	router.post(`${CHAT_API_PREFIX}/bookmarks`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.bookmarks.add(req.body.entry || {}))
	})
	router.delete(`${CHAT_API_PREFIX}/bookmarks`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.bookmarks.remove(req.body.entry || {}))
	})

	router.get(`${CHAT_API_PREFIX}/group-folders`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.groupFolders.list())
	})
	router.put(`${CHAT_API_PREFIX}/group-folders`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json(await client.groupFolders.set(req.body.folders || []))
	})

	router.get(`${CHAT_API_PREFIX}/emoji-usage`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const state = loadEmojiUsage(username)
		res.status(200).json({
			log: state.log,
			lastUsedAtByPack: state.lastUsedAtByPack,
			collection: state.collection,
		})
	})
	router.post(`${CHAT_API_PREFIX}/emoji-usage/record`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		recordEmojiUsage(username, req.body || {})
		res.status(200).json(loadUsagePayload(username))
	})
	router.post(`${CHAT_API_PREFIX}/emoji-usage/collection/packs`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const packId = String(req.body?.packId || '').trim()
		if (!packId) throw httpError(400, 'packId required')
		if (!await isPackAvailableToUser(username, packId))
			throw httpError(404, 'pack not available')
		addPackToCollection(username, packId)
		res.status(200).json({ collection: listCollection(username) })
	})
	router.delete(`${CHAT_API_PREFIX}/emoji-usage/collection/packs/:packId`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		removePackFromCollection(username, req.params.packId)
		res.status(200).json({ collection: listCollection(username) })
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
