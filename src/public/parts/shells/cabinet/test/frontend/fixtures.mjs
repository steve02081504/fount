import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'
import { assertIsolatedFrontendTest } from 'fount/scripts/test/playwright/guards.mjs'
import { waitForReadyGate } from 'fount/scripts/test/playwright/ready.mjs'

import { CABINET_APP_GATE } from '../../public/src/gate.mjs'

/** @type {string} */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME

/**
 *
 */
export const { test, expect } = createFountFixtures({ locale: 'zh-CN' })

/** @type {string[]} */
const collectedPageErrors = []

test.beforeEach(async ({ page, baseUrl, apiKey }) => {
	if (!TEST_USERNAME)
		throw new Error('FOUNT_TEST_USERNAME is required; run via test/frontend/run.mjs')
	test.setTimeout(ms('3m'))
	collectedPageErrors.length = 0
	page.on('pageerror', err => collectedPageErrors.push(String(err?.message || err)))
	await assertIsolatedFrontendTest({
		baseUrl,
		apiKey,
		expectedUsername: TEST_USERNAME,
		shellLabel: 'Cabinet',
	})
})

test.afterEach(async () => {
	expect(collectedPageErrors, 'unexpected browser page errors').toEqual([])
})

/**
 * @param {import('npm:@playwright/test').Page} page 页面
 * @param {string} baseUrl 根 URL
 * @returns {Promise<void>}
 */
export async function openCabinet(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:cabinet/#cabinet:default`, { waitUntil: 'domcontentloaded' })
	await waitForReadyGate(page, { ...CABINET_APP_GATE, label: 'Cabinet', timeout: ms('90s') })
	await expect(page.locator('#entryGrid')).toBeVisible({ timeout: ms('30s') })
}

/**
 * @param {string} baseUrl 根
 * @param {string} apiKey key
 * @param {string} name 文件夹名
 * @returns {Promise<{ id: string, name: string }>} 新建文件夹
 */
export async function createFolderViaApi(baseUrl, apiKey, name) {
	const q = `fount-apikey=${encodeURIComponent(apiKey)}`
	const list = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets?${q}`)
	if (!list.ok) throw new Error(await list.text())
	const res = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/default/entries?${q}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind: 'folder', name }),
	})
	const raw = await res.text()
	if (!res.ok) throw new Error(raw)
	const entry = JSON.parse(raw).entry
	return { id: entry.id, name: entry.name }
}
