import { authenticate } from '../../../../../../server/auth/index.mjs'
import {
	assignEntityShellData,
	loadEntityShellData,
} from '../../../../../../server/setting_loader.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'
import { normalizeTranslationPrefs } from '../lib/translationPrefs.mjs'

import { chatClientFromReq } from './shared.mjs'

const DATANAME = 'translationPreferences'

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
