/**
 * 【文件】public/index.mjs
 * 【职责】chat shell 根 URL 入口：应用主题与 i18n 后重定向到 Hub。
 * 【原理】保留 `location.hash`，replace 到 `/parts/shells:chat/hub/`。
 * 【关联】Hub index；@pages/scripts/theme/index.mjs、i18n.mjs。
 */
import { initTranslations } from '../../scripts/i18n/index.mjs'
import { applyTheme } from '../../scripts/theme/index.mjs'

/**
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	await initTranslations('chat')
	window.location.replace(`/parts/shells:chat/hub/${window.location.hash}`)
}

void init()
