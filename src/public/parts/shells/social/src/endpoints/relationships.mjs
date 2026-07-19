import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/** @type {{ path: string, flag: string, on: string, off: string }[]} */
const TOGGLE_RELATIONSHIPS = [
	{ path: 'follow', flag: 'follow', on: 'follow', off: 'unfollow' },
	{ path: 'block', flag: 'block', on: 'block', off: 'unblock' },
	{ path: 'hide', flag: 'hide', on: 'hide', off: 'unhide' },
	{ path: 'mute', flag: 'mute', on: 'mute', off: 'unmute' },
]

/**
 * 注册关注、拉黑等关系写路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerRelationshipsRoutes(router) {
	for (const { path, flag, on, off } of TOGGLE_RELATIONSHIPS) 
		router.post(`/api/parts/shells\\:social/relationships/${path}`, authenticate, socialJson(async (req, { client }) => {
			const target = req.body?.entityHash
			if (!target) throw httpError(400, 'entityHash required')
			return req.body?.[flag] === false
				? await client[off](target)
				: await client[on](target)
		}))
	

	router.post('/api/parts/shells\\:social/relationships/follow-approve', authenticate, socialJson(async (req, { client }) => {
		const followerPubKeyHex = String(req.body?.followerPubKeyHex || '')
		if (!followerPubKeyHex) throw httpError(400, 'invalid request')
		return { event: await client.approveFollow(followerPubKeyHex) }
	}))
}
