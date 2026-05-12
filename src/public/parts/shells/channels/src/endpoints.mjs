import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
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

/**
 * 为频道功能设置API端点
 * @param {import('express').Router} router - Express路由实例
 */
export function setEndpoints(router) {
	// 创建频道
	router.post('/api/parts/shells\\:channels/create', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const config = req.body

			const channel = await createChannel(username, config)
			res.status(201).json({ success: true, channel })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// 获取频道列表
	router.get('/api/parts/shells\\:channels/list', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const channels = await getChannelList(username)
			res.status(200).json({ success: true, channels })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// 获取频道详情
	router.get('/api/parts/shells\\:channels/:channelId', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			const channel = await getChannel(channelId)

			// 检查访问权限
			if (!channel.permissions.isPublic && !channel.subscribers.includes(username)) {
				return res.status(403).json({ success: false, error: 'Permission denied' })
			}

			res.status(200).json({ success: true, channel })
		} catch (error) {
			res.status(404).json({ success: false, error: error.message })
		}
	})

	// 更新频道设置
	router.put('/api/parts/shells\\:channels/:channelId', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const updates = req.body

			// 检查编辑权限
			const hasPermission = await checkPermission(username, channelId, 'canEditChannel')
			if (!hasPermission) {
				return res.status(403).json({ success: false, error: 'Permission denied' })
			}

			const channel = await updateChannel(channelId, updates)
			res.status(200).json({ success: true, channel })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// 删除频道
	router.delete('/api/parts/shells\\:channels/:channelId', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			// 检查删除权限
			const hasPermission = await checkPermission(username, channelId, 'canDeleteChannel')
			if (!hasPermission) {
				return res.status(403).json({ success: false, error: 'Permission denied' })
			}

			await deleteChannel(channelId)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// 订阅频道
	router.post('/api/parts/shells\\:channels/:channelId/subscribe', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const greeting = (req.body && typeof req.body.greeting === 'string') ? req.body.greeting : null

			await subscribeChannel(username, channelId, greeting)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(400).json({ success: false, error: error.message })
		}
	})

	// 取消订阅频道
	router.post('/api/parts/shells\\:channels/:channelId/unsubscribe', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			await unsubscribeChannel(username, channelId)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(400).json({ success: false, error: error.message })
		}
	})

	// 发布消息
	router.post('/api/parts/shells\\:channels/:channelId/post', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const { content, files } = req.body

			// 检查发布权限
			const hasPermission = await checkPermission(username, channelId, 'canPost')
			if (!hasPermission) {
				return res.status(403).json({ success: false, error: 'Permission denied' })
			}

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

	// 获取消息列表
	router.get('/api/parts/shells\\:channels/:channelId/messages', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)
			const { start = 0, limit = 50 } = req.query

			// 检查查看权限
			const hasPermission = await checkPermission(username, channelId, 'canViewHistory')
			if (!hasPermission) {
				return res.status(403).json({ success: false, error: 'Permission denied' })
			}

			const messages = await getMessages(channelId, Number(start), Number(limit))
			res.status(200).json({ success: true, messages })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// 获取频道成员列表
	router.get('/api/parts/shells\\:channels/:channelId/members', authenticate, async (req, res) => {
		try {
			const { channelId } = req.params
			const { username } = await getUserByReq(req)

			const hasPermission = await checkPermission(username, channelId, 'canViewHistory')
			if (!hasPermission) {
				return res.status(403).json({ success: false, error: 'Permission denied' })
			}

			const members = await getChannelMembers(channelId)
			res.status(200).json({ success: true, members })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})
}
