import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'

import { routeEntityHash, socialClientFromReq } from './shared.mjs'

/**
 * Social 作者表情包路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerEmojiPackRoutes(router) {
	const base = '/api/parts/shells\\:social/emoji-packs'

	router.get(`${base}/discover`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { buildNearbyAuthorPackOffers } = await import('../emojiPacks/discoverNetwork.mjs')
		res.status(200).json(await buildNearbyAuthorPackOffers(username, {
			limit: Number(req.query?.limit) || 48,
		}))
	})

	router.get(`${base}/available`, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json({ packs: await client.emojiPacks.listAvailable() })
	})

	router.get(base, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const entityHash = String(req.query.entityHash || client.entityHash).trim().toLowerCase()
		res.status(200).json({ packs: await client.emojiPacks.list(entityHash) })
	})

	router.get(`${base}/:entityHash/:packId`, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const pack = await client.emojiPacks.get(routeEntityHash(req.params), String(req.params.packId || ''))
		res.status(200).json({ pack })
	})

	router.post(base, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(201).json({ pack: await client.emojiPacks.create(req.body || {}) })
	})

	router.put(`${base}/:packId`, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json({ pack: await client.emojiPacks.update(String(req.params.packId || ''), req.body || {}) })
	})

	router.delete(`${base}/:packId`, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.emojiPacks.delete(String(req.params.packId || '')))
	})

	router.post(`${base}/:packId/emojis`, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(201).json(await client.emojiPacks.uploadEmoji(String(req.params.packId || ''), req))
	})

	router.delete(`${base}/:packId/emojis/:emojiId`, authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.emojiPacks.deleteEmoji(
			String(req.params.packId || ''),
			String(req.params.emojiId || ''),
		))
	})
}
