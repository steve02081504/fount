/**
 * 测试环境页面监视入口：组装 loop + a11y + cssvar + locale，bootstrap 后开闸。
 * Playwright 只认 `fount.test.watch`（`kick` / `drain` / `holdLocale` / `releaseLocale` / `started`）。
 */
import { requestRefresh, task as a11yTask } from './a11y.mjs'
import { task as cssvarTask } from './cssvar.mjs'
import { bootstrap, task as localeTask } from './locale.mjs'
import { holdLocale, releaseLocale } from './locale_hold.mjs'
import { drain, register, start, started } from './loop.mjs'
import { observe } from './mutations.mjs'
import { task as svgThemeTask } from './svg_theme.mjs'

globalThis.fount ??= {}
globalThis.fount.test ??= {}

register(a11yTask)
register(cssvarTask)
register(svgThemeTask)
register(localeTask)
observe(document.documentElement, {
	subtree: true,
	childList: true,
	attributes: true,
	characterData: true,
})

/**
 * 立刻要求一轮带 issue 刷新的 a11y，并等到扫完。
 * @returns {Promise<void>}
 */
function kick() {
	return started ? requestRefresh() : Promise.resolve()
}

/**
 * bootstrap locale 后开闸。
 * @returns {Promise<void>}
 */
async function boot() {
	try {
		await bootstrap()
	}
	catch (error) {
		console.warn('[test:watch] bootstrap failed', error)
	}
	start()
	await kick()
}

globalThis.fount.test.watch = {
	/**
	 * 是否已开闸（locale bootstrap 完成且 loop 已 start）。
	 * @returns {boolean} started
	 */
	get started() { return started },
	kick,
	drain,
	holdLocale,
	releaseLocale,
}
void boot()
