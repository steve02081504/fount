import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { isEntityHash128 } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { authenticate, getUserByReq } from '../../../../../../../server/auth.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../../../server/p2p_server/operator_identity.mjs'
import { getVaultFileByShareId, registerVaultFile } from '../../socialVaultIndex.mjs'
import { commitTimelineEvent } from '../../timeline/append.mjs'

/**
 * 注册 vault 文件相关路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerVaultRoutes(router) {
	router.post('/api/parts/shells\\:social/files', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = await resolveOperatorEntityHash(username)
		if (!self) throw httpError(403, 'identity required')
		const entry = await registerVaultFile(username, self, req.body)
		const event = await commitTimelineEvent(username, self, {
			type: 'file_share',
			content: {
				shareId: entry.shareId,
				fileId: entry.fileId,
				name: entry.name,
				mimeType: entry.mimeType,
				size: entry.size,
				visibility: entry.visibility,
			},
		}, { fanout: false })
		res.status(200).json({ entry, event })
	})

	router.get('/api/parts/shells\\:social/files/:shareId', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = await resolveOperatorEntityHash(username)
		const owner = String(req.query.owner || self || '').toLowerCase()
		if (!isEntityHash128(owner))
			throw httpError(400, 'invalid owner')
		const entry = await getVaultFileByShareId(username, owner, String(req.params.shareId))
		if (!entry) throw httpError(404, 'not found')
		res.status(200).json({ entry })
	})
}
