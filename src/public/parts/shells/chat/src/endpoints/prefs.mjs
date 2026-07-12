import { loadReputation } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { assignShellData, loadShellData } from '../../../../../../server/setting_loader.mjs'
import { listCared, setCared } from '../chat/lib/care.mjs'
import { loadNotifyPrefs, saveNotifyPrefs } from '../chat/lib/notifyPrefs.mjs'
import { resolveChatRecipient } from '../chat/lib/recipient.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerPrefsRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/bookmarks`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ entries: loadShellData(username, 'chat', 'bookmarks').entries || [] })
	})
	router.put(`${CHAT_API_PREFIX}/bookmarks`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entries = req.body.entries || []
		assignShellData(username, 'chat', 'bookmarks', { entries })
		res.status(200).json({ entries })
	})

	router.get(`${CHAT_API_PREFIX}/group-folders`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ folders: loadShellData(username, 'chat', 'groupFolders').folders || [] })
	})
	router.put(`${CHAT_API_PREFIX}/group-folders`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const folders = req.body.folders || []
		assignShellData(username, 'chat', 'groupFolders', { folders })
		res.status(200).json({ folders })
	})

	router.get(`${CHAT_API_PREFIX}/custom-emojis`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ entries: loadShellData(username, 'chat', 'customEmojis').entries || [] })
	})
	router.put(`${CHAT_API_PREFIX}/custom-emojis`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		assignShellData(username, 'chat', 'customEmojis', { entries: req.body.entries || [] })
		res.status(200).json({ entries: req.body.entries || [] })
	})
	router.post(`${CHAT_API_PREFIX}/custom-emojis/save`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const groupId = String(req.body.groupId || '').trim()
		const emojiId = String(req.body.emojiId || '').trim()
		const dataUrl = String(req.body.dataUrl || '').trim()
		if (!groupId || !emojiId)
			return res.status(400).json({ error: 'groupId and emojiId required' })
		if (!dataUrl.startsWith('data:'))
			return res.status(400).json({ error: 'dataUrl required (data:…)' })
		const entries = [...loadShellData(username, 'chat', 'customEmojis').entries || []]
		const id = `${groupId}/${emojiId}`
		const next = { id, groupId, emojiId, dataUrl, savedAt: Date.now() }
		const existingIndex = entries.findIndex(e => e?.id === id)
		if (existingIndex >= 0) entries[existingIndex] = next
		else entries.push(next)
		assignShellData(username, 'chat', 'customEmojis', { entries })
		res.status(200).json({ entry: next })
	})

	router.get(`${CHAT_API_PREFIX}/emoji-usage/frequent`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { listFrequentEmojis } = await import('../emojiUsage.mjs')
		const limit = Math.min(64, Math.max(1, Number.parseInt(String(req.query?.limit ?? '32'), 10) || 32))
		res.status(200).json({ entries: listFrequentEmojis(username, limit) })
	})

	router.get(`${CHAT_API_PREFIX}/reputation`, authenticate, async (_req, res) => {
		res.status(200).json({ reputation: loadReputation() })
	})

	router.get(`${CHAT_API_PREFIX}/care`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const ownerEntityHash = await resolveChatRecipient(username, req.query.ownerEntityHash)
		res.status(200).json({ cared: await listCared(username, ownerEntityHash) })
	})
	router.put(`${CHAT_API_PREFIX}/care`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const ownerEntityHash = await resolveChatRecipient(username, req.body.ownerEntityHash)
		await setCared(username, ownerEntityHash, req.body.targetEntityHash, req.body.cared !== false)
		res.status(200).json({ cared: await listCared(username, ownerEntityHash) })
	})

	router.get(`${CHAT_API_PREFIX}/aliases`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const data = loadShellData(username, 'chat', 'aliases')
		res.status(200).json({ entities: data.entities || {}, groups: data.groups || {} })
	})
	router.put(`${CHAT_API_PREFIX}/aliases`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const doc = { entities: req.body.entities || {}, groups: req.body.groups || {} }
		assignShellData(username, 'chat', 'aliases', doc)
		res.status(200).json(doc)
	})

	router.get(`${CHAT_API_PREFIX}/notify-prefs`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ prefs: loadNotifyPrefs(username) })
	})
	router.put(`${CHAT_API_PREFIX}/notify-prefs`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		saveNotifyPrefs(username, req.body.prefs || {})
		res.status(200).json({ prefs: loadNotifyPrefs(username) })
	})
}
