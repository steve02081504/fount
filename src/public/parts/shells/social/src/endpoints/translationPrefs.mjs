import {
	assignEntityShellData,
	loadEntityShellData,
} from '../../../../../../server/setting_loader.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

const SOCIAL_PREFIX = '/api/parts/shells\\:social'
const DATANAME = 'translationPreferences'

/**
 * @param {unknown} raw 原始偏好输入
 * @returns {{ autoTranslate: boolean, targetLocale?: string, excludeLocales?: string[] }} 规范化偏好
 */
function normalizeTranslationPrefs(raw) {
	const input = raw && typeof raw === 'object' ? raw : {}
	const prefs = { autoTranslate: input.autoTranslate === true }
	if (input.targetLocale != null) prefs.targetLocale = String(input.targetLocale)
	if (Array.isArray(input.excludeLocales))
		prefs.excludeLocales = input.excludeLocales.map(String)
	return prefs
}

/**
 * 注册翻译偏好 GET/PUT 路由（operator 实体级，Social shell）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTranslationPrefsRoutes(router) {
	router.get(`${SOCIAL_PREFIX}/translation-prefs`, authenticate, async (req, res) => {
		const { username, client } = await socialClientFromReq(req)
		const stored = loadEntityShellData(username, 'social', client.entityHash, DATANAME)
		res.status(200).json({ prefs: { autoTranslate: false, ...stored } })
	})

	router.put(`${SOCIAL_PREFIX}/translation-prefs`, authenticate, async (req, res) => {
		const { username, client } = await socialClientFromReq(req)
		const prefs = normalizeTranslationPrefs(req.body?.prefs)
		assignEntityShellData(username, 'social', client.entityHash, DATANAME, prefs)
		res.status(200).json({ prefs })
	})
}
