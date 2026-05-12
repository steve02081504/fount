import multer from 'multer'
import path from 'node:path'

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
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
	fileFilter: (req, file, cb) => {
		const allowedTypes = /jpeg|jpg|png|gif|webp/
		const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
		const mimetype = allowedTypes.test(file.mimetype)
		if (mimetype && extname)
			return cb(null, true)
		cb(new Error('Only image files are allowed'))
	},
})

export function setEndpoints(router) {
	const handleGetProfile = async (req, res) => {
		try {
			const username = req.params[0] || req.params.username
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
	router.get('/api/parts/shells\\:profile/:username', authenticate, handleGetProfile)
	router.get(/^\/api\/parts\/shells:profile\/([^/]+)$/, authenticate, handleGetProfile)

	const handleUpdateProfile = async (req, res) => {
		try {
			const username = req.params[0] || req.params.username
			const { username: currentUser } = await getUserByReq(req)
			if (username !== currentUser)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			const profile = await updateProfile(username, req.body)
			res.status(200).json({ success: true, profile })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.put('/api/parts/shells\\:profile/:username', authenticate, handleUpdateProfile)
	router.put(/^\/api\/parts\/shells:profile\/([^/]+)$/, authenticate, handleUpdateProfile)

	const handleUploadAvatar = async (req, res) => {
		try {
			const username = req.params[0] || req.params.username
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
	router.post('/api/parts/shells\\:profile/:username/avatar', authenticate, upload.single('avatar'), handleUploadAvatar)
	router.post(/^\/api\/parts\/shells:profile\/([^/]+)\/avatar$/, authenticate, upload.single('avatar'), handleUploadAvatar)

	const handleGetStats = async (req, res) => {
		try {
			const username = req.params[0] || req.params.username
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
	router.get('/api/parts/shells\\:profile/:username/stats', authenticate, handleGetStats)
	router.get(/^\/api\/parts\/shells:profile\/([^/]+)\/stats$/, authenticate, handleGetStats)

	const handleUpdateStatus = async (req, res) => {
		try {
			const username = req.params[0] || req.params.username
			const { username: currentUser } = await getUserByReq(req)
			if (username !== currentUser)
				return res.status(403).json({ success: false, error: 'Permission denied' })

			await updateStatus(username, req.body.status, req.body.customStatus)
			res.status(200).json({ success: true })
		} catch (error) {
			res.status(500).json({ success: false, error: error.message })
		}
	}
	router.post('/api/parts/shells\\:profile/:username/status', authenticate, handleUpdateStatus)
	router.post(/^\/api\/parts\/shells:profile\/([^/]+)\/status$/, authenticate, handleUpdateStatus)
}
