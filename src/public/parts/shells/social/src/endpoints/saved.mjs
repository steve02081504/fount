import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/**
 * 注册收藏帖与文件夹相关路由（client.saved.*）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSavedRoutes(router) {
	router.get('/api/parts/shells\\:social/saved-posts', authenticate, socialJson((_req, { client }) => client.saved.list()))

	router.get('/api/parts/shells\\:social/saved-posts/search', authenticate, socialJson((req, { client }) => {
		const q = String(req.query?.q || '')
		const limit = req.query?.limit != null ? Number(req.query.limit) : undefined
		return client.saved.search(q, { limit })
	}))

	router.post('/api/parts/shells\\:social/saved-posts/add', authenticate, socialJson((req, { client }) => {
		const body = req.body || {}
		return client.saved.add(body, body.folderId || null)
	}))

	router.post('/api/parts/shells\\:social/saved-posts/folders', authenticate, socialJson(async (req, { client }) => {
		const name = String(req.body?.name || '').trim()
		if (!name) throw httpError(400, 'name required')
		return client.saved.createFolder(name)
	}))

	router.post('/api/parts/shells\\:social/saved-posts/remove', authenticate, socialJson((req, { client }) => {
		const body = req.body || {}
		const folderId = body.folderId !== undefined && body.folderId !== ''
			? String(body.folderId)
			: undefined
		return client.saved.remove(body, folderId)
	}))

	router.post('/api/parts/shells\\:social/saved-posts/folders/rename', authenticate, socialJson(async (req, { client }) => {
		const folderId = String(req.body?.folderId || '')
		const name = String(req.body?.name || '').trim()
		if (!folderId || !name) throw httpError(400, 'folderId and name required')
		return client.saved.renameFolder(folderId, name)
	}))

	router.post('/api/parts/shells\\:social/saved-posts/folders/delete', authenticate, socialJson(async (req, { client }) => {
		const folderId = String(req.body?.folderId || '')
		if (!folderId) throw httpError(400, 'folderId required')
		return client.saved.deleteFolder(folderId)
	}))
}
