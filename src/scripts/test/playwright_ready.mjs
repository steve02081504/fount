/**
 * Playwright 等待 shell 前端 bootstrap 就绪（通过 document.documentElement.dataset，不 import 生产模块）。
 */

/**
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {{ datasetKey: string, label: string, timeout?: number }} opts 就绪 dataset 键与标签
 * @returns {Promise<void>}
 */
export async function waitForShellDatasetReady(page, { datasetKey, label, timeout = 90_000 }) {
	await page.waitForFunction(
		({ datasetKey, label }) => {
			const state = document.documentElement.dataset[datasetKey]
			if (state === 'error') throw new Error(`${label} bootstrap failed`)
			return state === 'ready'
		},
		{ datasetKey, label },
		{ timeout },
	)
}

/**
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForHubCoreReady(page) {
	return waitForShellDatasetReady(page, { datasetKey: 'hubCoreState', label: 'Hub' })
}

/**
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>}
 */
export function waitForSocialAppReady(page) {
	return waitForShellDatasetReady(page, { datasetKey: 'socialAppState', label: 'Social', timeout: 60_000 })
}
