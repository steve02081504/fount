import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { rebuildTaste } from '../taste/cluster.mjs'
import { revokeTasteAlias } from '../taste/mergeClaims.mjs'
import { listTasteTags, publishTagName } from '../taste/nameClaims.mjs'
import { collapseTasteWeights, loadTaste, mutateTaste } from '../taste/store.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 偏好 / 口味标签 HTTP（人与 agent 同入口；HTTP 固定 operator，agent 用 SocialClient）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTasteRoutes(router) {
	router.get('/api/parts/shells\\:social/taste', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const locale = String(req.query.locale || 'zh-CN')
		const store = await loadTaste(client.username, client.entityHash)
		const tags = await listTasteTags(client.username, client.entityHash, locale)
		res.status(200).json({
			privacy: store.privacy,
			clusteredAt: store.clusteredAt,
			aliases: store.aliases,
			tags,
		})
	})

	router.put('/api/parts/shells\\:social/taste', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const body = req.body || {}
		const store = await mutateTaste(client.username, client.entityHash, draft => {
			if (body.privacy && typeof body.privacy === 'object')
				draft.privacy = {
					publishPreferences: body.privacy.publishPreferences !== false,
					publishReactions: body.privacy.publishReactions !== false,
				}
			if (body.tags && typeof body.tags === 'object')
				for (const [tag, weight] of Object.entries(body.tags)) {
					const key = String(tag).trim().toLowerCase()
					if (!key) continue
					const value = Number(weight)
					if (!Number.isFinite(value)) continue
					if (value === 0) delete draft.manual[key]
					else draft.manual[key] = value
				}
			return draft
		})
		res.status(200).json({
			privacy: store.privacy,
			computed: store.computed,
			manual: store.manual,
			aliases: store.aliases,
			tagCount: collapseTasteWeights(store).size,
		})
	})

	router.post('/api/parts/shells\\:social/taste/rebuild', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const store = await rebuildTaste(client.username, client.entityHash)
		res.status(200).json({
			clusteredAt: store.clusteredAt,
			tagCount: collapseTasteWeights(store).size,
		})
	})

	router.post('/api/parts/shells\\:social/taste/names', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const tagHash = String(req.body?.tagHash || '').trim()
		const label = String(req.body?.label || '').trim()
		const locale = String(req.body?.locale || 'zh-CN').trim()
		if (!tagHash || !label) throw httpError(400, 'tagHash and label required')
		const event = await publishTagName(client.username, client.entityHash, { tagHash, label, locale })
		res.status(200).json({ event })
	})

	router.delete('/api/parts/shells\\:social/taste/aliases/:fromTag', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const store = await revokeTasteAlias(client.username, client.entityHash, String(req.params.fromTag || ''))
		res.status(200).json({ aliases: store.aliases })
	})
}
