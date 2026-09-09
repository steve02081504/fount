/**
 * 模块逻辑页：前端测试里直接跑浏览器模块逻辑的轻量基建。
 *
 * 后端 Deno 测试禁止安装 DOM shim（`no_dom_shim.mjs` 预载会让赋值当场爆炸）；
 * 依赖 document / window 的浏览器模块（markdown convertor、sanitizeHtml 等）一律在
 * Playwright 前端测试里经本 helper 跑：路由一个同源最小 HTML 页，并置 `fount.test.watch.disabled`
 * 跳过 page-watch（a11y / locale 扫描），i18n 由此处显式装载，然后用
 * `run` 在页面里 `import('/scripts/…')` / `import('/parts/…')` 执行逻辑，返回值在
 * Node 侧断言。昂贵的模块对象（如 markdown processor）可挂在页面常驻的
 * `globalThis.__fountModulePage` 上跨用例复用。
 */
import { ms } from '../../ms.mjs'

/** 模块逻辑页的路由路径（被 openModulePage 拦截 fulfill，不命中任何真实资源）。 */
const MODULE_PAGE_PATH = '/__fount_module_page__.html'

/**
 * @typedef {object} ModulePage
 * @property {import('npm:@playwright/test').Page} page 已就绪的模块逻辑页
 * @property {string} baseUrl 测试根 URL
 * @property {(fn: (arg: any) => unknown, arg?: unknown) => Promise<any>} run 在页面里执行模块逻辑
 */

/**
 * 打开模块逻辑页：同源最小 HTML（document 就绪、无站点 chrome、无 page-watch），
 * i18n bundle 已应用（convertor 等模块渲染期 geti18n 不会触发 [i18n:missing] 硬失败）。
 *
 * `run` 的回调必须是**无闭包**的独立函数（Playwright 以 toString 序列化）；它运行在
 * 页面里，可直接 `await import('/scripts/…')` 与操作 DOM。昂贵对象缓存惯例：
 * `globalThis.__fountModulePage.processor ??= await import('/scripts/features/markdown/convertor.mjs')…`。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {string} baseUrl 测试根 URL
 * @returns {Promise<ModulePage>} 模块逻辑页
 */
export async function openModulePage(page, baseUrl) {
	// markdown 链（template.mjs → base_dir）会拉起 pages/base.mjs；置 fount.test.watch.disabled
	// 让 base.mjs 跳过 page-watch（a11y / locale 扫描）——裸逻辑页没有 main / h1，也
	// 不该被页面级质量门扫描（要扫渲染产物请走真实 themed 页面，如 xssInjection）。
	// enabled 仍为 true：base.mjs 的 Sentry 分支依赖 !enabled，不能关。
	await page.addInitScript(() => {
		globalThis.fount ??= {}
		globalThis.fount.test ??= {}
		globalThis.fount.test.watch ??= {}
		globalThis.fount.test.watch.disabled = true
	})
	await page.route(
		url => new URL(url).pathname === MODULE_PAGE_PATH,
		route => route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>fount module page</title></head><body></body></html>',
		}),
	)
	await page.goto(`${baseUrl}${MODULE_PAGE_PATH}`, { waitUntil: 'domcontentloaded', timeout: ms('2m') })
	const identity = await page.evaluate(() => ({ href: location.href, title: document.title }))
	if (identity.title !== 'fount module page')
		throw new Error(`module page hijacked: ${identity.href} (title=${identity.title}) — route did not intercept`)
	await page.evaluate(() => {
		globalThis.__fountModulePage ??= {}
	})
	// 只装载 bundle（不走 applyTranslations：裸页面没有 pageid，会告警 undefined.title）。
	// convertor 等模块渲染期 geti18n 的 util.code_block.* 键都在全局 bundle 里，不会触发
	// browser_diagnostics 的 [i18n:missing] 硬失败。
	await page.evaluate(async () => {
		const index = await import('/scripts/i18n/index.mjs')
		const base = await import('/scripts/i18n/base.mjs')
		const langs = index.loadPreferredLangs()
		const available = await base.getAvailableLocales()
		const locale = index.getBestLocale([...langs, index.primaryLocale()], available)
		index.setI18nBundle(await base.loadLocaleData(langs), locale, 'module', langs)
	})
	return {
		page,
		baseUrl,
		/**
		 * 在页面里执行模块逻辑；返回值经结构化克隆回 Node 侧。
		 * @param {(arg: any) => unknown} fn 无闭包的页面侧函数（可 async）
		 * @param {unknown} [arg] 传给 fn 的参数（结构化克隆）
		 * @returns {Promise<any>} fn 的返回值
		 */
		run: (fn, arg) => page.evaluate(fn, arg),
	}
}
