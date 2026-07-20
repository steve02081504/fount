/**
 * 【文件】stickers/endpoints.mjs
 * 【职责】贴纸包与用户收藏的 REST：CRUD 包、上传贴纸、安装/收藏/最近使用及媒体文件下发。
 * 【原理】registerStickerRoutes 按 apiBase 正则挂路由；鉴权后 getReplicaFromReq；写操作校验作者 entity；二进制经 betterSendFile 从 resolveStickerFilePath 读取。
 * 【数据结构】packId、stickerId、multipart 上传、collection 安装列表、favorite/recent 条目。
 * 【关联】被 chat/src/endpoints.mjs 调用；依赖 stickers.mjs、upload/fromRequest、replica.mjs。
 */
import fs from 'node:fs'
import path from 'node:path'

import { authenticate } from '../../../../../../server/auth/index.mjs'
import { betterSendFile } from '../../../../../../server/web_server/resources.mjs'
import { getReplicaFromReq } from '../chat/lib/replica.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../upload/fromRequest.mjs'

import {
	getStickerPacks,
	createStickerPack,
	getStickerPack,
	updateStickerPack,
	deleteStickerPack,
	uploadSticker,
	deleteSticker,
	installPack,
	uninstallPack,
	getUserCollection,
	addToFavorites,
	removeFromFavorites,
	recordRecentUse,
	importStickerFromDataUrl,
	resolveStickerFilePath,
	findStickerPackHost,
} from './stickers.mjs'

const DEFAULT_STICKER_API = '/api/parts/shells:chat/stickers'

/**
 * @param {string} apiBase - 路由前缀
 * @param {string} tail - 正则尾部，须以 `/` 开头
 * @returns {RegExp} 路径正则
 */
function stickerPathRegex(apiBase, tail) {
	return new RegExp(`^${apiBase.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}${tail}`)
}

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {string} [apiBase=/api/parts/shells:chat/stickers] API 前缀
 * @returns {void}
 */
export function registerStickerRoutes(router, apiBase = DEFAULT_STICKER_API) {
	router.get(`${apiBase}/packs`, authenticate, async (req, res) => {
		const { operatorEntityHash } = await getReplicaFromReq(req)
		res.status(200).json({ packs: await getStickerPacks(operatorEntityHash) })
	})

	router.post(`${apiBase}/packs`, authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		res.status(201).json({
			pack: await createStickerPack(replicaUsername, operatorEntityHash, req.body),
		})
	})

	router.get(stickerPathRegex(apiBase, '/packs/([^/]+)$'), authenticate, async (req, res) => {
		res.status(200).json({ pack: await getStickerPack(req.params[0]) })
	})

	router.get(stickerPathRegex(apiBase, '/packs/([^/]+)/file/([^/]+)$'), authenticate, async (req, res) => {
		const packId = req.params[0]
		const filename = path.basename(req.params[1] || '')
		if (!/^[\w.-]+\.(png|gif|jpe?g|webp)$/iu.test(filename))
			return res.status(400).end()
		const pack = await getStickerPack(packId)
		const { operatorEntityHash, replicaUsername } = await getReplicaFromReq(req)
		if (!pack.isPublic && pack.authorEntityHash !== operatorEntityHash) {
			const collection = await getUserCollection(replicaUsername, operatorEntityHash)
			if (!collection.installedPacks.includes(packId))
				return res.status(403).end()
		}
		const host = findStickerPackHost(packId)
		if (!host) return res.status(404).end()
		const filePath = resolveStickerFilePath(host.replicaUsername, host.authorEntityHash, packId, filename)
		if (!fs.existsSync(filePath)) return res.status(404).end()
		return betterSendFile(res, filePath)
	})

	router.put(stickerPathRegex(apiBase, '/packs/([^/]+)$'), authenticate, async (req, res) => {
		const packId = req.params[0]
		const { operatorEntityHash } = await getReplicaFromReq(req)
		const pack = await getStickerPack(packId)
		if (pack.authorEntityHash !== operatorEntityHash)
			return res.status(403).json({ error: 'Permission denied' })
		res.status(200).json({ pack: await updateStickerPack(packId, req.body) })
	})

	router.delete(stickerPathRegex(apiBase, '/packs/([^/]+)$'), authenticate, async (req, res) => {
		const packId = req.params[0]
		const { operatorEntityHash } = await getReplicaFromReq(req)
		const pack = await getStickerPack(packId)
		if (pack.authorEntityHash !== operatorEntityHash)
			return res.status(403).json({ error: 'Permission denied' })
		await deleteStickerPack(packId)
		res.status(200).json({})
	})

	router.post(stickerPathRegex(apiBase, '/packs/([^/]+)/stickers$'), authenticate, async (req, res) => {
		const packId = req.params[0]
		const { operatorEntityHash } = await getReplicaFromReq(req)
		const pack = await getStickerPack(packId)
		if (pack.authorEntityHash !== operatorEntityHash)
			return res.status(403).json({ error: 'Permission denied' })
		const file = pickUploadedFile(req, 'sticker')
		if (!file)
			return res.status(400).json({ error: 'No file uploaded' })
		if (!await isAllowedImageUpload(file))
			return res.status(400).json({ error: 'Only image files are allowed' })
		if (file.buffer.length > 2 * 1024 * 1024)
			return res.status(400).json({ error: 'File too large (max 2MB)' })
		let tags = []
		if (req.body.tags)
			try {
				tags = JSON.parse(req.body.tags)
			}
			catch {
				return res.status(400).json({ error: 'Invalid tags format' })
			}
		res.status(201).json({ sticker: await uploadSticker(packId, file.buffer, file.originalname, { name: req.body.name, tags }) })
	})

	router.delete(stickerPathRegex(apiBase, '/packs/([^/]+)/stickers/([^/]+)$'), authenticate, async (req, res) => {
		const packId = req.params[0]
		const stickerId = req.params[1]
		const { operatorEntityHash } = await getReplicaFromReq(req)
		const pack = await getStickerPack(packId)
		if (pack.authorEntityHash !== operatorEntityHash)
			return res.status(403).json({ error: 'Permission denied' })
		await deleteSticker(packId, stickerId)
		res.status(200).json({})
	})

	router.post(stickerPathRegex(apiBase, '/install/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		await installPack(replicaUsername, operatorEntityHash, req.params[0])
		res.status(200).json({})
	})

	router.post(stickerPathRegex(apiBase, '/uninstall/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		await uninstallPack(replicaUsername, operatorEntityHash, req.params[0])
		res.status(200).json({})
	})

	router.get(`${apiBase}/collection`, authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		res.status(200).json({ collection: await getUserCollection(replicaUsername, operatorEntityHash) })
	})

	router.post(stickerPathRegex(apiBase, '/favorites/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		await addToFavorites(replicaUsername, operatorEntityHash, req.params[0])
		res.status(200).json({})
	})

	router.delete(stickerPathRegex(apiBase, '/favorites/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		await removeFromFavorites(replicaUsername, operatorEntityHash, req.params[0])
		res.status(200).json({})
	})

	router.post(`${apiBase}/import`, authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		const body = req.body || {}
		const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : ''
		if (!dataUrl.startsWith('data:image/'))
			return res.status(400).json({ error: 'dataUrl must be a data:image/* URL' })
		const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
		res.status(201).json({
			sticker: await importStickerFromDataUrl(replicaUsername, operatorEntityHash, dataUrl, name || undefined),
		})
	})

	router.post(stickerPathRegex(apiBase, '/recent/([^/]+)$'), authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		await recordRecentUse(replicaUsername, operatorEntityHash, req.params[0])
		res.status(200).json({})
	})
}
