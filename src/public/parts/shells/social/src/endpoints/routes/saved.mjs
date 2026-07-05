import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../../server/auth.mjs'
import {
	addSavedPost,
	createSavedFolder,
	enrichSavedPosts,
	loadSavedPosts,
	deleteSavedFolder,
	removeSavedPost,
	renameSavedFolder,
} from '../../savedPosts.mjs'

/**
 * 注册收藏帖与文件夹相关路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSavedRoutes(router) {
	router.get('/api/parts/shells\\:social/saved-posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await enrichSavedPosts(username, await loadSavedPosts(username)))
	})

	router.post('/api/parts/shells\\:social/saved-posts/add', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body
		res.status(200).json(await addSavedPost(username, body, body.folderId || null))
	})

	router.post('/api/parts/shells\\:social/saved-posts/folders', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const name = String(req.body?.name || '').trim()
		if (!name) throw httpError(400, 'name required')
		res.status(200).json(await createSavedFolder(username, name))
	})

	router.post('/api/parts/shells\\:social/saved-posts/remove', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body
		const folderId = body.folderId !== undefined && body.folderId !== ''
			? String(body.folderId)
			: undefined
		res.status(200).json(await removeSavedPost(username, body, folderId))
	})

	router.post('/api/parts/shells\\:social/saved-posts/folders/rename', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body
		const folderId = String(body.folderId || '')
		const name = String(body.name || '').trim()
		if (!folderId || !name)
			throw httpError(400, 'folderId and name required')
		res.status(200).json(await renameSavedFolder(username, folderId, name))
	})

	router.post('/api/parts/shells\\:social/saved-posts/folders/delete', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const folderId = String(req.body?.folderId || '')
		if (!folderId)
			throw httpError(400, 'folderId required')
		res.status(200).json(await deleteSavedFolder(username, folderId))
	})
}
