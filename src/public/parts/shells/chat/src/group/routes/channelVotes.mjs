/**
 * 【文件】group/routes/channelVotes.mjs
 * 【职责】频道 HTTP 路由（频道投票）。
 * 【关联】被 channels.mjs 聚合注册。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'

import {
	ensureChannel,
	resolveGroupMember,
} from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'


/**
 * 注册频道 频道投票 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelVoteRoutes(router, authenticate) {
	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/votes/:ballotId/cast`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const ballotId = decodeURIComponent(req.params.ballotId)
		const { choice } = req.body || {}
		if (choice == null)
			throw httpError(400, 'choice required')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)
		const event = await appendSignedLocalEvent(username, groupId, {
			type: 'vote_cast',
			channelId,
			timestamp: Date.now(),
			content: { ballotId, choice },
		})
		res.status(201).json({ event })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/:channelId/votes`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { question: rawQuestion, options: rawOptions, deadline, deadlineMs } = req.body || {}
		const question = String(rawQuestion || '').trim()
		const options = Array.isArray(rawOptions)
			? rawOptions.map(optionLabel => String(optionLabel).trim()).filter(Boolean).slice(0, 12)
			: []
		if (!question) throw httpError(400, 'question required')
		if (options.length < 2) throw httpError(400, 'at least 2 options required')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)
		let voteDeadline = null
		const deadlineText = String(deadline || '').trim()
		if (deadlineText)
			voteDeadline = deadlineText
		else if (Number.isFinite(Number(deadlineMs)) && Number(deadlineMs) > 0)
			voteDeadline = new Date(Date.now() + Number(deadlineMs)).toISOString()

		const event = await appendSignedLocalEvent(username, groupId, {
			type: 'message',
			channelId,
			timestamp: Date.now(),
			content: { type: 'vote', question, options, deadline: voteDeadline },
		})
		const { scheduleVoteDeadlines } = await import('../../chat/lib/voteDeadlineWatcher.mjs')
		void scheduleVoteDeadlines(username, groupId)
		res.status(201).json({ event, ballotId: event.id })
	})

}
