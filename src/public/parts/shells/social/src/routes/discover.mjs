import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../../server/auth.mjs'
import { getReplicaFromReq } from '../../../../../../../server/p2p_server/http_glue.mjs'
import { discoverWithNetwork } from '../../discovery.mjs'
import { getEntityProfile } from '../../feed.mjs'
import { ensureOperatorSocialReady } from '../../lib/bootstrap.mjs'
import { suggestMentions } from '../../lib/mentionSuggest.mjs'
import { buildNotifications } from '../../notifications.mjs'
import { searchPosts } from '../../search.mjs'
import { cacheTranslation, getCachedTranslation, translatePostText } from '../../translate.mjs'
import { buildTrendingHashtags } from '../../trending/hashtags.mjs'

/**
 * 注册探索、搜索、通知、翻译与 @ 建议路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDiscoverRoutes(router) {
	router.get('/api/parts/shells\\:social/search', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const searchQuery = String(req.query.q || '').trim()
		if (searchQuery.length < 2)
			throw httpError(400, 'query must be at least 2 characters')
		res.status(200).json(await searchPosts(username, {
			q: searchQuery,
			limit: Number(req.query.limit) || 30,
		}))
	})

	router.get('/api/parts/shells\\:social/hashtags/trending', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await buildTrendingHashtags(username, {
			limit: Number(req.query.limit) || 12,
		}))
	})

	router.get('/api/parts/shells\\:social/explore', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await discoverWithNetwork(username, {
			type: 'social_discover_request',
			n: Number(req.query.limit) || 20,
		}))
	})

	router.get('/api/parts/shells\\:social/explore/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await discoverWithNetwork(username, {
			type: 'social_post_discover_request',
			n: Number(req.query.limit) || 20,
			mediaOnly: req.query.mediaOnly === 'true',
		}))
	})

	router.get('/api/parts/shells\\:social/notifications', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await buildNotifications(username, {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})

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

	router.get('/api/parts/shells\\:social/mentions/suggest', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await suggestMentions(username, String(req.query.q || ''), Number(req.query.limit) || 20))
	})

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
