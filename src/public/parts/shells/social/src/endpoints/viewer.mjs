import { authenticate } from '../../../../../../server/auth/index.mjs'
import { getReplicaFromReq } from '../../../../../../server/p2p_server/http_glue.mjs'
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
		res.status(200).json({
			viewerEntityHash: entityHash,
			profile,
		})
	})
}
