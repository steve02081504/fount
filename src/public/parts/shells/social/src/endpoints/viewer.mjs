import { authenticate } from '../../../../../../server/auth/index.mjs'
import { getReplicaFromReq } from '../../../../../../server/p2p_server/http_glue.mjs'
import { listLocalAgentEntities } from '../federation/hosting.mjs'
import { ensureOperatorSocialReady } from '../lib/bootstrap.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'

/**
 * 注册 viewer 路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerViewerRoutes(router) {
	router.get('/api/parts/shells\\:social/viewer', authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		const entityHash = operatorEntityHash
			? await ensureOperatorSocialReady(replicaUsername)
			: null
		const profile = entityHash
			? await getEntityProfile(replicaUsername, entityHash)
			: null
		const agents = []
		for (const { entityHash: agentHash, charPartName } of listLocalAgentEntities(replicaUsername)) {
			const agentProfile = await getEntityProfile(replicaUsername, agentHash)
			agents.push({
				entityHash: agentHash,
				charPartName,
				displayName: agentProfile?.name || charPartName,
			})
		}
		res.status(200).json({
			viewerEntityHash: entityHash,
			operator: entityHash ? {
				entityHash,
				displayName: profile?.name || null,
			} : null,
			agents,
			profile,
		})
	})
}
