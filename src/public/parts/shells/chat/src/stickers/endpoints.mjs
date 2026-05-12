import path from 'node:path'

import multer from 'multer'

import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'

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
} from './stickers.mjs'

const storage = multer.memoryStorage()
const upload = multer({
	storage,
	limits: { fileSize: 2 * 1024 * 1024 },
	/**
	 * @param {import('npm:express').Request} req - 请求
	 * @param {Express.Multer.File} file - 上传文件
	 * @param {(err: Error | null, accept?: boolean) => void} cb - 校验回调
	 * @returns {void}
	 */
	fileFilter: (req, file, cb) => {
		const allowedTypes = /jpeg|jpg|png|gif|webp/
		const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
		const mimetype = allowedTypes.test(file.mimetype)
		if (mimetype && extname)
			return cb(null, true)
		cb(new Error('Only image files are allowed'))
	},
})

const DEFAULT_STICKER_API = '/api/parts/shells:chat/stickers'

/**
 * @param {string} apiBase - 路由前缀，如 `/api/parts/shells:chat/stickers`
 * @param {string} tail - 正则尾部，须以 `/` 开头
 * @returns {RegExp} 匹配完整路径的正则
 */
function stickerPathRegex(apiBase, tail) {
	return new RegExp(`^${apiBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${tail}`)
}

/**
 * 注册贴纸 REST 路由（可挂载多套前缀便于 chat shell 收口）。
 * @param {import('npm:websocket-express').Router} router - Express 路由
 * @param {string} [apiBase=/api/parts/shells:chat/stickers] - API 前缀
 * @returns {void}
 */
export function setEndpoints(router, apiBase = DEFAULT_STICKER_API) {
	router.get(`${apiBase}/packs`, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const packs = await getStickerPacks(username)
			res.status(200).json({ success: true, packs })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(`${apiBase}/packs`, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const pack = await createStickerPack(username, req.body)
			res.status(201).json({ success: true, pack })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(stickerPathRegex(apiBase, '/packs/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const pack = await getStickerPack(req.params[0])
			res.status(200).json({ success: true, pack })
		} catch (error) {
			res.status(404).json({ success: false, error: error.message })
		}
	})

	router.put(stickerPathRegex(apiBase, '/packs/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const packId = req.params[0]
			const { username } = await getUserByReq(req)
			const pack = await getStickerPack(packId)
			if (pack.author !== username)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const updatedPack = await updateStickerPack(packId, req.body)
			res.status(200).json({ success: true, pack: updatedPack })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(stickerPathRegex(apiBase, '/packs/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const packId = req.params[0]
			const { username } = await getUserByReq(req)
			const pack = await getStickerPack(packId)
			if (pack.author !== username)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			await deleteStickerPack(packId)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(stickerPathRegex(apiBase, '/packs/([^/]+)/stickers$'), authenticate, (req, res) => {
		upload.single('sticker')(req, res, async error => {
			if (error) {
				const isMultipartError = error.message?.includes?.('Unexpected end of form')
				return res.status(400).json({
					success: false,
					error: isMultipartError ? 'Invalid multipart upload data' : error.message,
				})
			}

			try {
				const packId = req.params[0]
				const { username } = await getUserByReq(req)
				const pack = await getStickerPack(packId)
				if (pack.author !== username)
					return res.status(403).json({ success: false, error: 'Permission denied' })

				if (!req.file)
					return res.status(400).json({ success: false, error: 'No file uploaded' })

				let tags = []
				if (req.body.tags) 
					try {
						tags = JSON.parse(req.body.tags)
					} catch {
						return res.status(400).json({ success: false, error: 'Invalid tags format' })
					}
				

				const metadata = {
					name: req.body.name,
					tags,
				}

				const sticker = await uploadSticker(packId, req.file.buffer, req.file.originalname, metadata)
				return res.status(201).json({ success: true, sticker })
			} catch (handlerError) {
				return res.status(500).json({ success: false, error: handlerError.message })
			}
		})
	})

	router.delete(stickerPathRegex(apiBase, '/packs/([^/]+)/stickers/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const packId = req.params[0]
			const stickerId = req.params[1]
			const { username } = await getUserByReq(req)
			const pack = await getStickerPack(packId)
			if (pack.author !== username)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			await deleteSticker(packId, stickerId)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(stickerPathRegex(apiBase, '/install/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			await installPack(username, req.params[0])
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.post(stickerPathRegex(apiBase, '/uninstall/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			await uninstallPack(username, req.params[0])
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.get(stickerPathRegex(apiBase, '/user/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const requestedUser = req.params[0]
			if (requestedUser !== username)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const collection = await getUserCollection(username)
			res.status(200).json({ success: true, collection })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(stickerPathRegex(apiBase, '/favorites/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			await addToFavorites(username, req.params[0])
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(stickerPathRegex(apiBase, '/favorites/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			await removeFromFavorites(username, req.params[0])
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(stickerPathRegex(apiBase, '/recent/([^/]+)$'), authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			await recordRecentUse(username, req.params[0])
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	})
}
