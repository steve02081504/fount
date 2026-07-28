/**
 * 实体作者表情包 REST。
 */
import { applySafeContentHeaders } from '../../../../../../scripts/http_content.mjs'
import { httpError } from '../../../../../../scripts/http_error.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../../../../../../server/web_server/multipart_upload.mjs'
import { bufferToDataUrl } from '../emojiPacks/packStore.mjs'

import {
	createEntityPack,
	deleteEntityPack,
	deleteEntityPackEmoji,
	listEntityPacks,
	loadEntityPackManifest,
	packSummary,
	readEntityPackEmojiBinary,
	updateEntityPack,
	uploadEntityPackEmoji,
} from './entityEmojis.mjs'
import { getReplicaFromReq, isWritableLocalEntityForUser } from './http.mjs'

const CHAT_PREFIX = '/api/parts/shells:chat'
const ENTITY_HASH_SEGMENT = '[\\da-f]{128}'

/**
 * @param {string} tail 路径尾部
 * @returns {RegExp} 路径正则
 */
function entityEmojiPath(tail) {
	return new RegExp(`^${CHAT_PREFIX}/entities/(${ENTITY_HASH_SEGMENT})${tail}`, 'i')
}

/**
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {import('npm:express').Response} res HTTP 响应
 * @param {{ buffer: Buffer, mimeType: string, entry?: object, packId?: string }} local 本地二进制
 * @param {string} emojiId 表情 ID
 * @returns {void}
 */
function sendEmojiBinary(req, res, local, emojiId) {
	const wantJson = req.query?.json === '1' || String(req.headers.accept || '').includes('application/json')
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
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerEntityEmojiRoutes(router, authenticate) {
	router.get(entityEmojiPath('/emoji-packs$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packs = await listEntityPacks(replicaUsername, entityHash)
		res.status(200).json({ packs: packs.map(packSummary) })
	})

	router.post(entityEmojiPath('/emoji-packs$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			throw httpError(403, 'not writable')
		const pack = await createEntityPack(replicaUsername, entityHash, req.body || {})
		res.status(201).json({ pack })
	})

	router.get(entityEmojiPath('/emoji-packs/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packId = req.params[1]
		const pack = await loadEntityPackManifest(replicaUsername, entityHash, packId)
		if (!pack) throw httpError(404, 'pack not found')
		res.status(200).json({ pack })
	})

	router.put(entityEmojiPath('/emoji-packs/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packId = req.params[1]
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			throw httpError(403, 'not writable')
		res.status(200).json({
			pack: await updateEntityPack(replicaUsername, entityHash, packId, req.body || {}),
		})
	})

	router.delete(entityEmojiPath('/emoji-packs/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packId = req.params[1]
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			throw httpError(403, 'not writable')
		const ok = await deleteEntityPack(replicaUsername, entityHash, packId)
		if (!ok) throw httpError(404, 'pack not found')
		res.status(200).json({})
	})

	router.post(entityEmojiPath('/emoji-packs/([^/]+)/emojis$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packId = req.params[1]
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			throw httpError(403, 'not writable')
		const file = pickUploadedFile(req, 'emoji')
		if (!file) throw httpError(400, 'No file uploaded')
		if (!await isAllowedImageUpload(file)) throw httpError(400, 'Only image files are allowed')
		const entry = await uploadEntityPackEmoji(
			replicaUsername,
			entityHash,
			packId,
			file.buffer,
			file.originalname,
			file.mimetype,
			req.body?.name,
		)
		res.status(201).json({ emoji: entry })
	})

	router.delete(entityEmojiPath('/emoji-packs/([^/]+)/emojis/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packId = req.params[1]
		const emojiId = req.params[2]
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			throw httpError(403, 'not writable')
		const ok = await deleteEntityPackEmoji(replicaUsername, entityHash, packId, emojiId)
		if (!ok) throw httpError(404, 'emoji not found')
		res.status(200).json({})
	})

	router.get(entityEmojiPath('/emoji-packs/([^/]+)/emojis/([^/]+)/data$'), authenticate, async (req, res) => {
		const { replicaUsername } = await getReplicaFromReq(req)
		const entityHash = req.params[0]
		const packId = req.params[1]
		const emojiId = req.params[2]
		const local = await readEntityPackEmojiBinary(replicaUsername, entityHash, packId, emojiId)
		if (!local) throw httpError(404, 'emoji not found')
		sendEmojiBinary(req, res, local, emojiId)
	})
}
