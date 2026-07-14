import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册关注、拉黑等关系写路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerRelationshipsRoutes(router) {
	router.post('/api/parts/shells\\:social/relationships/follow', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const target = req.body?.entityHash
		if (!target) throw httpError(400, 'entityHash required')
		const result = req.body?.follow === false
			? await client.unfollow(target)
			: await client.follow(target)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:social/relationships/block', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const target = req.body?.entityHash
		if (!target) throw httpError(400, 'entityHash required')
		const result = req.body?.block === false
			? await client.unblock(target)
			: await client.block(target)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:social/relationships/hide', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const target = req.body?.entityHash
		if (!target) throw httpError(400, 'entityHash required')
		const result = req.body?.hide === false
			? await client.unhide(target)
			: await client.hide(target)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:social/relationships/mute', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const target = req.body?.entityHash
		if (!target) throw httpError(400, 'entityHash required')
		const result = req.body?.mute === false
			? await client.unmute(target)
			: await client.mute(target)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:social/relationships/follow-approve', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const followerPubKeyHex = String(req.body?.followerPubKeyHex || '')
		if (!followerPubKeyHex) throw httpError(400, 'invalid request')
		const event = await client.approveFollow(followerPubKeyHex)
		res.status(200).json({ event })
	})
}
