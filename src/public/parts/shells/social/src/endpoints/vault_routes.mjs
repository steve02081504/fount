import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { cacheTranslation, getCachedTranslation, translatePostText } from '../translate.mjs'
import { getVaultFileByShareId, registerVaultFile } from '../vault.mjs'

import { resolveOperatorEntityHash } from './lib/operatorEntity.mjs'

/**
 * 注册翻译与 vault 文件相关路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerVaultRoutes(router) {
	router.post('/api/parts/shells\\:social/translate', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const text = String(req.body?.text || '')
		const targetLang = String(req.body?.targetLang || 'zh-CN')
		const cacheKey = `${targetLang}:${text.slice(0, 2000)}`
		const cached = getCachedTranslation(username, cacheKey)
		if (cached) return res.status(200).json({ translated: cached, cached: true })
		const translated = await translatePostText(text, targetLang)
		cacheTranslation(username, cacheKey, translated)
		res.status(200).json({ translated, cached: false })
	})

	router.post('/api/parts/shells\\:social/files', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = await resolveOperatorEntityHash(username)
		if (!self) return res.status(403).json({ error: 'identity required' })
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
			return res.status(400).json({ error: 'invalid owner' })
		const entry = await getVaultFileByShareId(username, owner, String(req.params.shareId))
		if (!entry) return res.status(404).json({ error: 'not found' })
		res.status(200).json({ entry })
	})
}
