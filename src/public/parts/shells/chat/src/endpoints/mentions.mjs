import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { getState } from '../chat/dag/materialize.mjs'
import {
	getMentionsSeenAt,
	readMentionInbox,
	setMentionsSeenAt,
} from '../chat/lib/mentionInbox.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

/**
 * 为 mention 列表 enrich 群/频道名。
 * @param {string} username 用户
 * @param {object[]} mentions inbox 行
 * @returns {Promise<object[]>} 附带 groupName/channelName 的行
 */
async function enrichMentionRows(username, mentions) {
	/** @type {Map<string, object>} */
	const stateCache = new Map()
	return Promise.all(mentions.map(async row => {
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
export function registerMentionRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/mentions`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const page = await readMentionInbox(username, {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		})
		res.status(200).json({
			mentions: await enrichMentionRows(username, page.mentions),
			nextCursor: page.nextCursor,
			unreadCount: page.unreadCount,
		})
	})

	router.get(`${CHAT_API_PREFIX}/mentions/seen`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ seenAt: getMentionsSeenAt(username) })
	})

	router.put(`${CHAT_API_PREFIX}/mentions/seen`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const at = Number(req.body?.at) || Date.now()
		setMentionsSeenAt(username, at)
		res.status(200).json({ seenAt: at })
	})
}
