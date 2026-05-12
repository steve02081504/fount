import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'

import {
	createChannel,
	getChannelList,
	getChannel,
	updateChannel,
	deleteChannel,
	subscribeChannel,
	unsubscribeChannel,
	postMessage,
	getMessages,
	checkPermission,
	getChannelMembers
} from './channel.mjs'

const DEFAULT_CHANNELS_API = '/api/parts/shells:chat/channels'

/**
 * 频道 REST 路由（可挂载多套前缀，供 chat shell 收口）。
 * @param {import('npm:websocket-express').Router} router - Express 路由
 * @param {string} [apiBase=/api/parts/shells:chat/channels] - API 前缀
 * @returns {void}
 */
export function setEndpoints(router, apiBase = DEFAULT_CHANNELS_API) {
	router.post(`${apiBase}/create`, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const channel = await createChannel(username, req.body)
			res.status(201).json({ success: true, channel })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(`${apiBase}/list`, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const channels = await getChannelList(username)
			res.status(200).json({ success: true, channels })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(`${apiBase}/:channelId/subscribe`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const greeting = req.body && typeof req.body.greeting === 'string' ? req.body.greeting : null

			await subscribeChannel(username, channelId, greeting)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.post(`${apiBase}/:channelId/unsubscribe`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			await unsubscribeChannel(username, channelId)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.post(`${apiBase}/:channelId/post`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const { content, files } = req.body

			const hasPermission = await checkPermission(username, channelId, 'canPost')
			if (!hasPermission)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const message = await postMessage(channelId, {
				author: username,
				content,
				files
			})

			res.status(201).json({ success: true, message })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(`${apiBase}/:channelId/messages`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const { start = 0, limit = 50 } = req.query

			const hasPermission = await checkPermission(username, channelId, 'canViewHistory')
			if (!hasPermission)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const messages = await getMessages(channelId, Number(start), Number(limit))
			res.status(200).json({ success: true, messages })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(`${apiBase}/:channelId/members`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			const hasPermission = await checkPermission(username, channelId, 'canViewHistory')
			if (!hasPermission)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const members = await getChannelMembers(channelId)
			res.status(200).json({ success: true, members })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(`${apiBase}/:channelId`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			const channel = await getChannel(channelId)

			if (!channel.permissions.isPublic && !channel.subscribers.includes(username))
				return res.status(403).json({ success: false, error: 'Permission denied' })

			res.status(200).json({ success: true, channel })
		} catch (error) {
			res.status(404).json({ success: false, error: error.message })
		}
	})

	router.put(`${apiBase}/:channelId`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const updates = req.body

			const hasPermission = await checkPermission(username, channelId, 'canEditChannel')
			if (!hasPermission)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const channel = await updateChannel(channelId, updates)
			res.status(200).json({ success: true, channel })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(`${apiBase}/:channelId`, authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			const hasPermission = await checkPermission(username, channelId, 'canDeleteChannel')
			if (!hasPermission)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			await deleteChannel(channelId)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})
}
