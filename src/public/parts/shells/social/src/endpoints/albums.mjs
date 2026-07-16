import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { routeEntityHash, socialClientFromReq } from './shared.mjs'

/**
 * 注册相册路由（SocialClient 薄封装）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerAlbumsRoutes(router) {
	router.get('/api/parts/shells\\:social/albums', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const entityHash = String(req.query.entityHash || client.entityHash).trim().toLowerCase()
		res.status(200).json({ albums: await client.albums.list(entityHash) })
	})

	router.get('/api/parts/shells\\:social/albums/:entityHash', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json({ albums: await client.albums.list(routeEntityHash(req.params)) })
	})

	router.get('/api/parts/shells\\:social/albums/:entityHash/:albumId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const detail = await client.albums.get(routeEntityHash(req.params), String(req.params.albumId || ''))
		res.status(200).json(detail)
	})

	router.post('/api/parts/shells\\:social/albums', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.albums.create(req.body || {}))
	})

	router.post('/api/parts/shells\\:social/albums/:albumId/update', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.albums.update(String(req.params.albumId || ''), req.body || {}))
	})

	router.delete('/api/parts/shells\\:social/albums/:albumId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const deletePosts = req.body?.deletePosts === true || req.query.deletePosts === '1'
		res.status(200).json(await client.albums.delete(String(req.params.albumId || ''), { deletePosts }))
	})

	router.post('/api/parts/shells\\:social/albums/:albumId/posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const postId = String(req.body?.postId || '')
		if (!postId) throw httpError(400, 'postId required')
		res.status(200).json(await client.albums.addPost(String(req.params.albumId || ''), postId))
	})

	router.delete('/api/parts/shells\\:social/albums/:albumId/posts/:postId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.albums.removePost(
			String(req.params.albumId || ''),
			String(req.params.postId || ''),
		))
	})

	router.post('/api/parts/shells\\:social/albums/move-post', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const postId = String(req.body?.postId || '')
		const toAlbumId = String(req.body?.toAlbumId || '')
		if (!postId || !toAlbumId) throw httpError(400, 'postId and toAlbumId required')
		res.status(200).json(await client.albums.movePost(
			postId,
			String(req.body?.fromAlbumId || ''),
			toAlbumId,
		))
	})
}
