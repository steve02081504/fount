/**
 * group/routes/groupEmojis.mjs — 群表情包 REST + 内容端点。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { handleError } from 'fount/scripts/errorHandlers.mjs'

import { applySafeContentHeaders } from '../../../../../../../scripts/http_content.mjs'
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { getUserByReq } from '../../../../../../../server/auth/index.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../../../../../../../server/web_server/multipart_upload.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { replicateGroupEmojiManifestToUserRoom } from '../../chat/federation/groupEmojiFederation.mjs'
import { ensureFederationRoom } from '../../chat/federation/room.mjs'
import { governanceChannelId } from '../access.mjs'
import { resolveGroupEmojiContent, resolvePackEmojiContent } from '../emojiContentResolve.mjs'
import {
	bufferToDataUrl,
	createPack,
	deletePack,
	deletePackEmoji,
	listGroupPacks,
	loadPackManifest,
	packSummary,
	updatePack,
	uploadPackEmoji,
} from '../groupEmojis.mjs'

import { ensureCanInChannel, requireGroupMember } from './middleware.mjs'
import { CHAT_API_PREFIX, GROUPS_PREFIX } from './path.mjs'

/**
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {{ buffer: Buffer, mimeType: string, entry?: object }} local 本地二进制结果
 * @param {string} emojiId 表情 ID
 * @returns {void} 返回值
 */
function sendLocalEmojiBinary(req, res, local, emojiId) {
	const wantJson = req.query?.json === '1' || (req.headers.accept || '').includes('application/json')
	if (wantJson) {
		res.status(200).json({
			dataUrl: bufferToDataUrl(local.buffer, local.mimeType),
			mimeType: local.mimeType,
			contentHash: local.entry?.contentHash || null,
			packId: local.packId || null,
		})
		return
	}
	applySafeContentHeaders(res, {
		mimeType: local.mimeType || 'image/png',
		filename: `${emojiId}.bin`,
	})
	res.setHeader('Cache-Control', 'private, max-age=86400')
	res.status(200).send(local.buffer)
}

/**
 * 发送表情二进制响应（JSON dataUrl 或文件流）。
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} [packId] 参数
 * @returns {Promise<void>} 返回值
 */
async function sendEmojiContentResponse(req, res, username, groupId, emojiId, packId) {
	const contentHash = String(req.query?.contentHash || '').trim()
	const local = await resolveGroupEmojiContent(username, groupId, emojiId, { contentHash, packId })
	if (!local) throw httpError(404, 'emoji not found')
	sendLocalEmojiBinary(req, res, local, emojiId)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} entry manifest 条目
 * @returns {Promise<void>} 返回值
 */
async function replicateAfterUpload(username, groupId, entry) {
	const slot = await ensureFederationRoom(username, groupId)
	replicateGroupEmojiManifestToUserRoom(username, groupId, entry).catch(handleError)
	if (slot?.replicateGroupEmojiManifest)
		slot.replicateGroupEmojiManifest(entry).catch(handleError)
	if (slot?.replicateGroupEmoji)
		slot.replicateGroupEmoji(entry.emojiId, entry.packId).catch(handleError)
}

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void} 返回值
 */
export function registerGroupEmojiRoutes(router, authenticate) {
	// —— pack-aware ——
	router.get(`${GROUPS_PREFIX}/:groupId/emoji-packs`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const packs = await listGroupPacks(username, groupId)
		res.status(200).json({ packs: packs.map(packSummary) })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/emoji-packs`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const channelId = governanceChannelId(state)
		ensureCanInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')
		try {
			const pack = await createPack(username, groupId, {
				packId: req.body?.packId,
				localized: req.body?.localized,
			})
			res.status(201).json({ pack })
		}
		catch (error) {
			throw httpError(400, error?.message || 'create pack failed')
		}
	})

	router.get(`${GROUPS_PREFIX}/:groupId/emoji-packs/:packId`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const pack = await loadPackManifest(username, groupId, req.params.packId)
		if (!pack) throw httpError(404, 'pack not found')
		res.status(200).json({ pack })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/emoji-packs/:packId`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const channelId = governanceChannelId(state)
		ensureCanInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')
		try {
			const pack = await updatePack(username, groupId, req.params.packId, {
				localized: req.body?.localized,
			})
			res.status(200).json({ pack })
		}
		catch (error) {
			throw httpError(error?.message === 'pack not found' ? 404 : 400, error?.message || 'update pack failed')
		}
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/emoji-packs/:packId`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const channelId = governanceChannelId(state)
		ensureCanInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')
		const { packId } = req.params
		const ok = await deletePack(username, groupId, packId)
		if (!ok) throw httpError(404, 'pack not found')
		if (state.groupSettings?.defaultEmojiPackId === packId)
			await appendSignedLocalEvent(username, groupId, {
				type: 'group_settings_update',
				timestamp: Date.now(),
				content: { defaultEmojiPackId: null },
			})
		res.status(200).json({ packId, deleted: true })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/emoji-packs/:packId/emojis`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupContext: { username, groupId, state, member }, params: { packId } } = req
		const channelId = governanceChannelId(state)
		ensureCanInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')
		const file = pickUploadedFile(req, 'emoji')
		if (!file || !await isAllowedImageUpload(file))
			throw httpError(400, 'invalid emoji image')
		if (!await loadPackManifest(username, groupId, packId))
			try {
				await createPack(username, groupId, { packId })
			}
			catch (error) {
				throw httpError(400, error?.message || 'create pack failed')
			}
		const entry = await uploadPackEmoji(
			username,
			groupId,
			packId,
			file.buffer,
			file.originalname,
			file.mimetype,
			req.body?.name,
		)
		await replicateAfterUpload(username, groupId, entry)
		res.status(201).json({ entry })
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/emoji-packs/:packId/emojis/:emojiId`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupContext: { username, groupId, state, member }, params: { packId, emojiId } } = req
		const channelId = governanceChannelId(state)
		ensureCanInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId, 'MANAGE_MESSAGES required')
		const ok = await deletePackEmoji(username, groupId, packId, emojiId)
		if (!ok) throw httpError(404, 'emoji not found')
		res.status(200).json({ packId, emojiId, deleted: true })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/emoji-packs/:packId/emojis/:emojiId/data`, authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		const { groupId, packId, emojiId } = req.params
		return sendEmojiContentResponse(req, res, username, groupId, emojiId, packId)
	})

	router.get(`${CHAT_API_PREFIX}/emoji-content/:packId/:emojiId`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { packId, emojiId } = req.params
		const contentHash = String(req.query?.contentHash || '').trim()
		const local = await resolvePackEmojiContent(username, packId, emojiId, { contentHash })
		if (!local) throw httpError(404, 'emoji not found')
		sendLocalEmojiBinary(req, res, local, emojiId)
	})

	router.get(`${CHAT_API_PREFIX}/emoji-packs/discover`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { buildNearbyGroupPackOffers } = await import('../../emojiPacks/discoverNetwork.mjs')
		res.status(200).json(await buildNearbyGroupPackOffers(username, {
			limit: Number(req.query?.limit) || 48,
		}))
	})

	router.get(`${CHAT_API_PREFIX}/emoji-packs`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { listAvailableGroupPacksForUser } = await import('../groupEmojis.mjs')
		const { listAvailableEntityPacksForUser } = await import('../../entity/entityEmojis.mjs')
		const { resolveOperatorEntityHashForUser } = await import('../../entity/identity.mjs')
		const groupId = String(req.query?.groupId || '').trim() || undefined
		const groupPacks = await listAvailableGroupPacksForUser(username, { groupId })
		const operatorEntityHash = await resolveOperatorEntityHashForUser(username)
		const entityPacks = operatorEntityHash
			? await listAvailableEntityPacksForUser(username, operatorEntityHash)
			: []
		res.status(200).json({ packs: [...groupPacks, ...entityPacks] })
	})
}
