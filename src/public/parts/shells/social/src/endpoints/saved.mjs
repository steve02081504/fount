import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册收藏帖与文件夹相关路由（client.saved.*）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSavedRoutes(router) {
	router.get('/api/parts/shells\\:social/saved-posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.saved.list())
	})

	router.get('/api/parts/shells\\:social/saved-posts/search', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const q = String(req.query?.q || '')
		const limit = req.query?.limit != null ? Number(req.query.limit) : undefined
		res.status(200).json(await client.saved.search(q, { limit }))
	})

	router.post('/api/parts/shells\\:social/saved-posts/add', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const body = req.body || {}
		res.status(200).json(await client.saved.add(body, body.folderId || null))
	})

	router.post('/api/parts/shells\\:social/saved-posts/folders', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const name = String(req.body?.name || '').trim()
		if (!name) throw httpError(400, 'name required')
		res.status(200).json(await client.saved.createFolder(name))
	})

	router.post('/api/parts/shells\\:social/saved-posts/remove', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const body = req.body || {}
		const folderId = body.folderId !== undefined && body.folderId !== ''
			? String(body.folderId)
			: undefined
		res.status(200).json(await client.saved.remove(body, folderId))
	})

	router.post('/api/parts/shells\\:social/saved-posts/folders/rename', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const folderId = String(req.body?.folderId || '')
		const name = String(req.body?.name || '').trim()
		if (!folderId || !name)
			throw httpError(400, 'folderId and name required')
		res.status(200).json(await client.saved.renameFolder(folderId, name))
	})

	router.post('/api/parts/shells\\:social/saved-posts/folders/delete', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const folderId = String(req.body?.folderId || '')
		if (!folderId)
			throw httpError(400, 'folderId required')
		res.status(200).json(await client.saved.deleteFolder(folderId))
	})
}
