/**
 * 测试环境页面监视入口：组装 loop + a11y + locale，bootstrap 后开闸。
 * Playwright 只认 `fount.test.watch`（`kick` / `drain` / `holdLocale` / `releaseLocale` / `started`）。
 */
import { requestRefresh, task as a11yTask } from './a11y.mjs'
import { bootstrap, holdLocale, releaseLocale, task as localeTask } from './locale.mjs'
import { drain, isStarted, registerTask, start } from './loop.mjs'
import { observe } from './mutations.mjs'

globalThis.fount ??= {}
globalThis.fount.test ??= {}

registerTask(a11yTask)
registerTask(localeTask)
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
	return isStarted() ? requestRefresh() : Promise.resolve()
}

/**
 * bootstrap locale 后开闸。
 * @returns {Promise<void>}
 */
async function boot() {
	try {
		await bootstrap()
	}
	catch { /* i18n 不可用仍开闸 */ }
	start()
	await kick()
}

globalThis.fount.test.watch = {
	/**
	 * 是否已开闸（locale bootstrap 完成且 loop 已 start）。
	 * @returns {boolean} started
	 */
	get started() { return isStarted() },
	kick,
	drain,
	holdLocale,
	releaseLocale,
}
void boot()
