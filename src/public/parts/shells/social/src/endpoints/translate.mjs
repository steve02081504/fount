import { primaryLocaleForUser } from '../../../../../../scripts/locale.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { cacheTranslation, getCachedTranslation, translatePostText } from '../translate.mjs'

/**
 * 注册翻译路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTranslateRoutes(router) {
	router.post('/api/parts/shells\\:social/translate', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const text = String(req.body?.text || '')
		const targetLang = String(req.body?.targetLang || primaryLocaleForUser(username))
		const cacheKey = `${targetLang}:${text.slice(0, 2000)}`
		const cached = getCachedTranslation(username, cacheKey)
		if (cached) return res.status(200).json({ translated: cached, cached: true })
		const translated = await translatePostText(text, targetLang)
		cacheTranslation(username, cacheKey, translated)
		res.status(200).json({ translated, cached: false })
	})
}
