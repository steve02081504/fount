import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { getState } from '../chat/dag/materialize.mjs'
import {
	getChatInboxSeenAt,
	listChatInbox,
	setChatInboxSeenAt,
} from '../chat/lib/inbox.mjs'
import { resolveChatRecipient } from '../chat/lib/recipient.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

/**
 * 为 inbox 列表 enrich 群/频道名。
 * @param {string} username 用户
 * @param {object[]} items inbox 行
 * @returns {Promise<object[]>} 附带 groupName/channelName 的行
 */
async function enrichInboxRows(username, items) {
	/** @type {Map<string, object>} */
	const stateCache = new Map()
	return Promise.all(items.map(async row => {
		let state = stateCache.get(row.groupId)
		if (!state) {
			state = (await getState(username, row.groupId)).state
			stateCache.set(row.groupId, state)
		}
		return {
			...row,
			groupName: state.groupMeta?.name || row.groupId,
			channelName: state.channels?.[row.channelId]?.name || row.channelId,
		}
	}))
}

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerInboxRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/inbox`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const recipientEntityHash = await resolveChatRecipient(username, req.query.recipientEntityHash)
		const kinds = req.query.kinds
			? String(req.query.kinds).split(',').map(kind => kind.trim()).filter(Boolean)
			: undefined
		const page = await listChatInbox(username, recipientEntityHash, {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			kinds,
		})
		res.status(200).json({
			items: await enrichInboxRows(username, page.items),
			nextCursor: page.nextCursor,
			unreadCount: page.unreadCount,
		})
	})

	router.get(`${CHAT_API_PREFIX}/inbox/seen`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const recipientEntityHash = await resolveChatRecipient(username, req.query.recipientEntityHash)
		res.status(200).json({ seenAt: getChatInboxSeenAt(username, recipientEntityHash) })
	})

	router.put(`${CHAT_API_PREFIX}/inbox/seen`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const recipientEntityHash = await resolveChatRecipient(username, req.body?.recipientEntityHash)
		const at = Number(req.body?.at) || Date.now()
		setChatInboxSeenAt(username, recipientEntityHash, at)
		res.status(200).json({ seenAt: at })
	})
}
