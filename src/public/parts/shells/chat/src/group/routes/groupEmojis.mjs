/**
 * 【文件】group/routes/groupEmojis.mjs
 * 【职责】群自定义表情的 REST：列表、上传、删除、二进制 data 与联邦拉取回填。
 * 【原理】成员校验；上传需治理频道 MANAGE_EMOJIS；读写委托 groupEmojis.mjs；data 路由 betterSendFile；联邦缺失时 ensureFederationRoom 后拉取。
 * 【数据结构】manifest entries、multipart 图片、emojiId 路径参数。
 * 【关联】被 group/endpoints.mjs 注册；依赖 group/groupEmojis.mjs、chat/federation/room、upload/fromRequest。
 */
import { PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { betterSendFile } from '../../../../../../../server/web_server/resources.mjs'
import { ensureFederationRoom } from '../../chat/federation/room.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../../upload/fromRequest.mjs'
import { governanceChannelId } from '../access.mjs'
import {
	bufferToDataUrl,
	deleteGroupEmoji,
	loadGroupEmojiManifest,
	persistGroupEmojiFromDataUrl,
	readGroupEmojiBinary,
	resolveGroupEmojiBinaryPath,
	uploadGroupEmoji,
} from '../groupEmojis.mjs'

import { ensureCanInChannel, requireGroupMember } from './middleware.mjs'

/**
 * 注册群自定义表情 REST 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGroupEmojiRoutes(router, authenticate) {
	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/emojis$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const entries = await loadGroupEmojiManifest(username, groupId)
		res.status(200).json({ entries })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/emojis$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const channelId = governanceChannelId(state)
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')) return
		const file = pickUploadedFile(req, 'emoji')
		if (!file || !await isAllowedImageUpload(file))
			return res.status(400).json({ error: 'invalid emoji image' })
		const entry = await uploadGroupEmoji(
			username,
			groupId,
			file.buffer,
			file.originalname,
			file.mimetype,
			req.body?.name,
		)
		const slot = await ensureFederationRoom(username, groupId)
		if (slot?.replicateGroupEmoji)
			void slot.replicateGroupEmoji(entry.emojiId).catch(() => { })
		res.status(201).json({ entry })
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/emojis\/([^/]+)$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const emojiId = req.params[1]
		const channelId = governanceChannelId(state)
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')) return
		const ok = await deleteGroupEmoji(username, groupId, emojiId)
		if (!ok) return res.status(404).json({ error: 'emoji not found' })
		res.status(200).json({})
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/emojis\/([^/]+)\/data$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const emojiId = req.params[1]

		let local = await readGroupEmojiBinary(username, groupId, emojiId)
		if (!local) {
			const slot = await ensureFederationRoom(username, groupId)
			const fetched = slot?.requestGroupEmoji
				? await slot.requestGroupEmoji(emojiId)
				: null
			if (fetched?.dataUrl) {
				await persistGroupEmojiFromDataUrl(
					username,
					groupId,
					emojiId,
					fetched.dataUrl,
					fetched.mimeType,
				).catch(() => { })
				local = await readGroupEmojiBinary(username, groupId, emojiId)
			}
		}

		if (!local) return res.status(404).json({ error: 'emoji not found' })

		const wantJson = req.query?.json === '1' || String(req.headers.accept || '').includes('application/json')
		if (wantJson)
			return res.status(200).json({
				dataUrl: bufferToDataUrl(local.buffer, local.mimeType),
				mimeType: local.mimeType,
			})


		const filePath = await resolveGroupEmojiBinaryPath(username, groupId, emojiId)
		if (!filePath) return res.status(404).json({ error: 'emoji file missing' })
		betterSendFile(res, filePath, { cacheControl: 'private, max-age=86400' })
	})
}
