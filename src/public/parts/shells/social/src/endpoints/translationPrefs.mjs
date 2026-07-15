import { authenticate } from '../../../../../../server/auth/index.mjs'
import {
	assignEntityShellData,
	loadEntityShellData,
} from '../../../../../../server/setting_loader.mjs'
import { normalizeTranslationPrefs } from '../../../chat/src/lib/translationPrefs.mjs'

import { socialClientFromReq } from './shared.mjs'

const SOCIAL_PREFIX = '/api/parts/shells\\:social'
const DATANAME = 'translationPreferences'

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
