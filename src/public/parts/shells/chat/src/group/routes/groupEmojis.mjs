/**
 * group/routes/groupEmojis.mjs — 群自定义表情 REST + 非成员内容端点。
 */
import { PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { getUserByReq } from '../../../../../../../server/auth.mjs'
import { betterSendFile } from '../../../../../../../server/web_server/resources.mjs'
import { ensureFederationRoom } from '../../chat/federation/room.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../../upload/fromRequest.mjs'
import { governanceChannelId } from '../access.mjs'
import { resolveGroupEmojiContent } from '../emojiContentResolve.mjs'
import {
	bufferToDataUrl,
	deleteGroupEmoji,
	loadGroupEmojiManifest,
	resolveGroupEmojiBinaryPath,
	uploadGroupEmoji,
} from '../groupEmojis.mjs'

import { ensureCanInChannel, requireGroupMember } from './middleware.mjs'
import { CHAT_API_PREFIX, GROUPS_PREFIX } from './path.mjs'

/**
 * 发送表情二进制响应（JSON dataUrl 或文件流）。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @param {import('npm:express').Response} res - HTTP 响应。
 * @param {string} username - 用户名。
 * @param {string} groupId - 群 ID。
 * @param {string} emojiId - 表情 ID。
 * @returns {Promise<void>}
 */
async function sendEmojiContentResponse(req, res, username, groupId, emojiId) {
	const contentHash = String(req.query?.contentHash || '').trim()
	const local = await resolveGroupEmojiContent(username, groupId, emojiId, { contentHash })
	if (!local) return res.status(404).json({ error: 'emoji not found' })

	const wantJson = req.query?.json === '1' || String(req.headers.accept || '').includes('application/json')
	if (wantJson)
		return res.status(200).json({
			dataUrl: bufferToDataUrl(local.buffer, local.mimeType),
			mimeType: local.mimeType,
			contentHash: local.entry?.contentHash || null,
		})

	const filePath = await resolveGroupEmojiBinaryPath(username, groupId, emojiId)
	if (!filePath) {
		res.setHeader('Content-Type', local.mimeType || 'image/png')
		res.setHeader('Cache-Control', 'private, max-age=86400')
		return res.status(200).send(local.buffer)
	}
	betterSendFile(res, filePath, { cacheControl: 'private, max-age=86400' })
}

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGroupEmojiRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/emojis`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const entries = await loadGroupEmojiManifest(username, groupId)
		res.status(200).json({ entries })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/emojis`, authenticate, requireGroupMember(), async (req, res) => {
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

	router.delete(`${GROUPS_PREFIX}/:groupId/emojis/:emojiId`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const { emojiId } = req.params
		const channelId = governanceChannelId(state)
		if (!ensureCanInChannel(res, state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')) return
		const ok = await deleteGroupEmoji(username, groupId, emojiId)
		if (!ok) return res.status(404).json({ error: 'emoji not found' })
		res.status(200).json({ emojiId, deleted: true })
	})

	router.get(`${CHAT_API_PREFIX}/emoji-content/:groupId/:emojiId`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, emojiId } = req.params
		return sendEmojiContentResponse(req, res, username, groupId, emojiId)
	})

	router.get(`${GROUPS_PREFIX}/:groupId/emojis/:emojiId/data`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, emojiId } = req.params
		return sendEmojiContentResponse(req, res, username, groupId, emojiId)
	})
}
