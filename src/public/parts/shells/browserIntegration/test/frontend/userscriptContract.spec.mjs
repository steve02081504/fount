/**
 * BrowserIntegration 用户脚本的 autorun 同步契约。
 *
 * 后端 `GET /api/parts/shells:browserIntegration/autorun-scripts` 返回 `{ scripts }`
 *（本仓库的 HTTP API 约定：成功不加 `success` 包装）。用户脚本曾一直读已不存在的 `success` 字段，
 * 于是每次页面加载都抛 'Server response invalid.'：自动运行脚本静默停在本地旧缓存上，
 * 服务器侧的新增 / 删除永不下发。
 *
 * 这里把用户脚本真的注入页面（GM API 打桩、同源 `fetch` 顶上 `GM.xmlHttpRequest`），
 * 让它同步一个真实存在的脚本，断言它写进了自己的 GM 存储。
 */
import { readFile } from 'node:fs/promises'

import { test, expect } from './fixtures.mjs'

const USERSCRIPT_PATH = new URL('../../public/script.user.js', import.meta.url)
const AUTORUN_PATH = '/api/parts/shells:browserIntegration/autorun-scripts'

/**
 * 通过 shell API 建一个自动运行脚本。
 * @param {string} baseUrl 节点根 URL
 * @param {string} apiKey API key
 * @param {string} comment 备注（即断言用的标识）
 * @returns {Promise<{ id: string, comment: string }>} 新建的脚本
 */
async function createAutoRunScript(baseUrl, apiKey, comment) {
	const response = await fetch(`${baseUrl}${AUTORUN_PATH}?fount-apikey=${encodeURIComponent(apiKey)}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ urlRegex: '^https://example\\.invalid/', script: 'void 0', comment }),
	})
	const raw = await response.text()
	if (!response.ok) throw new Error(`create autorun script failed: ${response.status} ${raw}`)
	return JSON.parse(raw).script
}

/**
 * 删除自动运行脚本。
 * @param {string} baseUrl 节点根 URL
 * @param {string} apiKey API key
 * @param {string} id 脚本 id
 * @returns {Promise<void>}
 */
async function deleteAutoRunScript(baseUrl, apiKey, id) {
	const response = await fetch(`${baseUrl}${AUTORUN_PATH}/${encodeURIComponent(id)}?fount-apikey=${encodeURIComponent(apiKey)}`, { method: 'DELETE' })
	if (!response.ok) throw new Error(`delete autorun script failed: ${response.status} ${await response.text()}`)
}

test.describe('BrowserIntegration userscript autorun sync', () => {
	test('userscript stores the server script list in its own storage', async ({ page, baseUrl, apiKey }) => {
		const comment = `pw-userscript-${Date.now()}`
		const seeded = await createAutoRunScript(baseUrl, apiKey, comment)
		try {
			await page.addInitScript(() => {
				const store = new Map()
				globalThis.__gmStore = store
				globalThis.GM = {
					/**
					 * 异步读取存储。
					 * @param {string} key 键
					 * @param {*} fallback 缺省值
					 * @returns {Promise<*>} 存储值
					 */
					async getValue(key, fallback) { return store.has(key) ? store.get(key) : fallback },
					/**
					 * 异步写入存储。
					 * @param {string} key 键
					 * @param {*} value 值
					 * @returns {Promise<void>} 无
					 */
					async setValue(key, value) { store.set(key, value) },
					/**
					 * 用户脚本假定 GM.xmlHttpRequest 不受 CORS 约束；页面与 API 同源，直接 fetch 顶上。
					 * @param {object} request 请求
					 * @param {string} [request.method] HTTP 方法
					 * @param {string} request.url 请求 URL
					 * @param {object} [request.headers] 请求头
					 * @param {string} [request.data] 请求体
					 * @param {(response: { status: number, statusText: string, responseText: string }) => void} request.onload 成功回调
					 * @param {(error: *) => void} request.onerror 失败回调
					 * @returns {void} 无
					 */
					xmlHttpRequest({ method = 'GET', url, headers, data, onload, onerror }) {
						fetch(url, { method, headers, body: data })
							.then(async response => onload({ status: response.status, statusText: response.statusText, responseText: await response.text() }))
							.catch(error => onerror(error))
					},
					/**
					 * 同步读取存储（用户脚本顶层用 `GM_getValue`）。
					 * @param {string} key 键
					 * @param {*} fallback 缺省值
					 * @returns {*} 存储值
					 */
					getValueSync(key, fallback) { return store.has(key) ? store.get(key) : fallback },
					/**
					 * 同步写入存储（用户脚本顶层用 `GM_setValue`）。
					 * @param {string} key 键
					 * @param {*} value 值
					 * @returns {void} 无
					 */
					setValueSync(key, value) { store.set(key, value) },
				}
				globalThis.GM_getValue = globalThis.GM.getValueSync
				globalThis.GM_setValue = globalThis.GM.setValueSync
				globalThis.GM_info = { script: { version: '0.0.0.0' } }
				globalThis.unsafeWindow = globalThis
			})

			// 一张同源空白页：用户脚本要在任意页面上跑（也避开 shell 自己的全局名与异步启动代码），
			// 但 fetch 必须同源，所以由 route 在节点源上顶一个空文档，而不是去动 shell 页面。
			await page.route('**/userscript-contract-fixture', route => route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>fixture</title></head><body></body></html>',
			}))
			await page.goto(`${baseUrl}/userscript-contract-fixture`, { waitUntil: 'load' })
			await page.addScriptTag({ content: await readFile(USERSCRIPT_PATH, 'utf8') })

			// 真实流程里配置是配对 / 迁移校验通过后由 setStoredData 写入的；脚本初始化时无主机，
			// findAndConnect 无事可做，测试只驱动「同步脚本列表」这一步。
			await page.evaluate(async ({ host, protocol, apiKey }) => {
				await globalThis.setStoredData(host, null, protocol, apiKey)
				await globalThis.syncScriptsFromServer()
			}, { host: new URL(baseUrl).host, protocol: new URL(baseUrl).protocol, apiKey })

			const stored = await page.evaluate(() => globalThis.__gmStore.get('fount_autorun_scripts'))
			expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ id: seeded.id, comment })]))
		}
		finally {
			await deleteAutoRunScript(baseUrl, apiKey, seeded.id)
		}
	})
})
