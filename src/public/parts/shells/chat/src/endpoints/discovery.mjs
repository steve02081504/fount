import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDiscoveryRoutes(router) {
	router.get('/api/parts/shells\\:chat/discovery', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { buildDiscoveryQueryResponse } = await import('../chat/discovery/index.mjs')
		const { localNodeHash } = await import('../chat/federation/dagDependencies.mjs')
		const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
		const entries = await buildDiscoveryQueryResponse(username, localNodeHash(), limit)
		res.status(200).json({ entries })
	})

	router.post('/api/parts/shells\\:chat/discovery/refresh', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { broadcastDiscoveryQuery, publishDiscoveryAnnounceAllGroups } = await import('../chat/federation/discoveryRelay.mjs')
		const { localNodeHash } = await import('../chat/federation/dagDependencies.mjs')
		await publishDiscoveryAnnounceAllGroups(username, localNodeHash())
		await broadcastDiscoveryQuery(username, localNodeHash())
		res.status(200).json({})
	})
}
