import { primaryLocaleForUser } from '../../../../../../scripts/locale.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import {
	cacheTranslation,
	getCachedTranslation,
	translateText,
} from '../../../../../../server/translate.mjs'

const CACHE_DATANAME = 'chatTranslateCache'

/**
 * 注册 Chat shell 翻译路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTranslateRoutes(router) {
	router.post('/api/parts/shells\\:chat/translate', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const text = String(req.body?.text || '')
		const targetLang = String(req.body?.targetLang || primaryLocaleForUser(username))
		const cacheKey = `${targetLang}:${text.slice(0, 2000)}`
		const cached = getCachedTranslation(username, CACHE_DATANAME, cacheKey)
		if (cached) return res.status(200).json({ translated: cached, cached: true })
		const translated = await translateText(text, targetLang)
		cacheTranslation(username, CACHE_DATANAME, cacheKey, translated)
		res.status(200).json({ translated, cached: false })
	})
}
