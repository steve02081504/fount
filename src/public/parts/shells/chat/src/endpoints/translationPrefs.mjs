import {
	assignEntityShellData,
	loadEntityShellData,
} from '../../../../../../server/setting_loader.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

import { chatClientFromReq } from './shared.mjs'

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
 * 注册翻译偏好 GET/PUT 路由（operator 实体级，Chat shell）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTranslationPrefsRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/translation-prefs`, authenticate, async (req, res) => {
		const { username, client } = await chatClientFromReq(req)
		const stored = loadEntityShellData(username, 'chat', client.entityHash, DATANAME)
		res.status(200).json({ prefs: { autoTranslate: false, ...stored } })
	})

	router.put(`${CHAT_API_PREFIX}/translation-prefs`, authenticate, async (req, res) => {
		const { username, client } = await chatClientFromReq(req)
		const prefs = normalizeTranslationPrefs(req.body?.prefs)
		assignEntityShellData(username, 'chat', client.entityHash, DATANAME, prefs)
		res.status(200).json({ prefs })
	})
}
