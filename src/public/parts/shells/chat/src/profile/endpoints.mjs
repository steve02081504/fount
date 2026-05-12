import path from 'node:path'

import multer from 'multer'

import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'

import {
	getProfile,
	updateProfile,
	uploadAvatar,
	getStats,
	updateStatus,
} from './profile.mjs'

const storage = multer.memoryStorage()
const upload = multer({
	storage,
	limits: { fileSize: 5 * 1024 * 1024 },
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

const DEFAULT_PROFILE_API = '/api/parts/shells:chat/profile'

/**
 * 用户资料 REST 路由（可挂载多套前缀，供 chat shell 收口）。
 * @param {import('npm:websocket-express').Router} router - Express 路由
 * @param {string} [apiBase=/api/parts/shells:chat/profile] - API 前缀
 * @returns {void}
 */
export function setEndpoints(router, apiBase = DEFAULT_PROFILE_API) {
	/**
	 * 获取用户统计信息
	 * @param {import('npm:express').Request} req - Express 请求
	 * @param {import('npm:express').Response} res - Express 响应
	 * @returns {Promise<void>}
	 */
	const handleGetStats = async (req, res) => {
		try {
			const username = req.params.username
			const { username: currentUser } = await getUserByReq(req)
			const profile = await getProfile(username)
			if (username !== currentUser && !profile.privacy.showStats)
				return res.status(403).json({ success: false, error: 'Stats are private' })

			const stats = await getStats(username)
			res.status(200).json({ success: true, stats })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.get(`${apiBase}/:username/stats`, authenticate, handleGetStats)

	/**
	 * 更新用户在线/自定义状态
	 * @param {import('npm:express').Request} req - Express 请求
	 * @param {import('npm:express').Response} res - Express 响应
	 * @returns {Promise<void>}
	 */
	const handleUpdateStatus = async (req, res) => {
		try {
			const username = req.params.username
			const { username: currentUser } = await getUserByReq(req)
			if (username !== currentUser)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			await updateStatus(username, req.body.status, req.body.customStatus)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.post(`${apiBase}/:username/status`, authenticate, handleUpdateStatus)

	/**
	 * 上传用户头像
	 * @param {import('npm:express').Request} req - Express 请求（含 multipart 文件）
	 * @param {import('npm:express').Response} res - Express 响应
	 * @returns {Promise<void>}
	 */
	const handleUploadAvatar = async (req, res) => {
		try {
			const username = req.params.username
			const { username: currentUser } = await getUserByReq(req)
			if (username !== currentUser)
				return res.status(403).json({ success: false, error: 'Permission denied' })
			if (!req.file)
				return res.status(400).json({ success: false, error: 'No file uploaded' })

			const avatarUrl = await uploadAvatar(username, req.file.buffer, req.file.originalname)
			res.status(200).json({ success: true, avatarUrl })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.post(`${apiBase}/:username/avatar`, authenticate, upload.single('avatar'), handleUploadAvatar)

	/**
	 * 获取用户资料（含隐私裁剪）
	 * @param {import('npm:express').Request} req - Express 请求
	 * @param {import('npm:express').Response} res - Express 响应
	 * @returns {Promise<void>}
	 */
	const handleGetProfile = async (req, res) => {
		try {
			const username = req.params.username
			const { username: currentUser } = await getUserByReq(req)
			const profile = await getProfile(username)

			if (username !== currentUser) {
				if (!profile.privacy.showEmail)
					delete profile.email
				if (!profile.privacy.showStats)
					delete profile.stats
			}

			res.status(200).json({ success: true, profile })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.get(`${apiBase}/:username`, authenticate, handleGetProfile)

	/**
	 * 更新用户资料字段
	 * @param {import('npm:express').Request} req - Express 请求
	 * @param {import('npm:express').Response} res - Express 响应
	 * @returns {Promise<void>}
	 */
	const handleUpdateProfile = async (req, res) => {
		try {
			const username = req.params.username
			const { username: currentUser } = await getUserByReq(req)
			if (username !== currentUser)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const profile = await updateProfile(username, req.body)
			res.status(200).json({ success: true, profile })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.put(`${apiBase}/:username`, authenticate, handleUpdateProfile)
}
