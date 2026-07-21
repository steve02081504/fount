import { ms } from 'fount/scripts/ms.mjs'
import { createFountFixtures } from 'fount/scripts/test/playwright/fixtures.mjs'
import { waitForReadyGate } from 'fount/scripts/test/playwright/ready.mjs'

import { CABINET_APP_GATE } from '../../public/src/gate.mjs'

/** @type {string} */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME

/** Cabinet 前端 E2E fixture（隔离节点 + 3m timeout）。 */
export const { test, expect } = createFountFixtures({
	locale: 'zh-CN',
	isolated: { shellLabel: 'Cabinet', timeout: ms('3m') },
})

/**
 * @param {string} baseUrl 根
 * @param {string} apiKey key
 * @returns {Promise<string>} 个人柜 id
 */
export async function ensurePersonalCabinet(baseUrl, apiKey) {
	const q = `fount-apikey=${encodeURIComponent(apiKey)}`
	const listRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets?${q}`)
	if (!listRes.ok) throw new Error(await listRes.text())
	const personal = (await listRes.json()).cabinets?.find(row => row.type === 'personal')
	if (personal?.cabinet_id) return personal.cabinet_id
	const createRes = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets?${q}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Test', visibility: { visibility: 'private' } }),
	})
	const createRaw = await createRes.text()
	if (!createRes.ok) throw new Error(createRaw)
	const cabinetId = JSON.parse(createRaw).cabinet?.cabinet_id
	if (!cabinetId) throw new Error('create personal cabinet failed')
	return cabinetId
}

/**
 * @param {import('npm:@playwright/test').Page} page 页面
 * @param {string} baseUrl 根 URL
 * @param {string} cabinetId 柜
 * @returns {Promise<void>}
 */
export async function openCabinet(page, baseUrl, cabinetId) {
	await page.goto(`${baseUrl}/parts/shells:cabinet/#cabinet:${cabinetId}`, { waitUntil: 'domcontentloaded' })
	await waitForReadyGate(page, { ...CABINET_APP_GATE, label: 'Cabinet', timeout: ms('90s') })
	await expect(page.locator('#entryGrid')).toBeVisible({ timeout: ms('30s') })
}

/**
 * @param {string} baseUrl 根
 * @param {string} apiKey key
 * @param {string} name 文件夹名
 * @returns {Promise<{ id: string, name: string, cabinet_id: string }>} 新建文件夹
 */
export async function createFolderViaApi(baseUrl, apiKey, name) {
	const cabinetId = await ensurePersonalCabinet(baseUrl, apiKey)
	const q = `fount-apikey=${encodeURIComponent(apiKey)}`
	const res = await fetch(`${baseUrl}/api/parts/shells:cabinet/cabinets/${encodeURIComponent(cabinetId)}/entries?${q}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind: 'folder', name }),
	})
	const raw = await res.text()
	if (!res.ok) throw new Error(raw)
	const entry = JSON.parse(raw).entry
	return { id: entry.id, name: entry.name, cabinet_id: cabinetId }
}
