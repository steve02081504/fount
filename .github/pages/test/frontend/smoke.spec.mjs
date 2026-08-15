import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'

import { expect, test } from './fixtures.mjs'

test.describe('GitHub Pages smoke', () => {
	test('root redirects toward install wait', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/wait\/install\/?/, { timeout: 30_000 })
		await expect(page.locator('#launchButton')).toBeVisible({ timeout: 30_000 })
		// 等 hero 视觉入场结束（h1 入场前即可 AT 可达；此处断言产品动画落定）
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
	})

	test('root redirect keeps search and hash', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/?utm_source=linux.sb&rid=smoke1#welcome`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/wait\/install\/\?utm_source=linux\.sb&rid=smoke1#welcome$/, { timeout: 30_000 })
	})

	test('install wait screen loads base + test watch', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/wait/install/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#launchButton')).toBeVisible({ timeout: 30_000 })
		await expect.poll(async () => page.evaluate(() => Boolean(globalThis.fount?.test?.watch?.started)), {
			timeout: 15_000,
		}).toBe(true)
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('h1').first()).toBeAttached()
	})

	test('utm_source shows welcome dialog after hero intro', async ({ page, baseUrl }) => {
		const dialog = page.locator('#utm-welcome-dialog')
		/**
		 * 打开带 utm_source 的安装页并等待欢迎弹窗。
		 */
		const openWelcome = async () => {
			await page.goto(`${baseUrl}/wait/install/?utm_source=linux.sb`, { waitUntil: 'domcontentloaded' })
			await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
			await expect(dialog).toBeVisible({ timeout: 5_000 })
			await expect(page.locator('#utm-welcome-message')).toContainText('linux.sb')
		}

		await openWelcome()
		await dialog.locator('.modal-action button').click()
		await expect(dialog).toBeHidden()

		await openWelcome()
		// DaisyUI 的 backdrop button 铺满全屏，中心被 modal-box 挡住；点角落才是真实关闭路径
		await dialog.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } })
		await expect(dialog).toBeHidden()
	})

	test('protocol shows offline dialog; badges render', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/protocol/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#offline_dialog')).toBeVisible({ timeout: 30_000 })

		await page.goto(`${baseUrl}/badges/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
		await expect.poll(async () => page.evaluate(() => Boolean(globalThis.fount?.test?.watch?.started)), {
			timeout: 15_000,
		}).toBe(true)
	})

	test('oauth bounce shows offline dialog when fount is unreachable', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/oauth/callback/?hostUrl=http://127.0.0.1:1&code=c&state=s`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#offline_dialog')).toBeVisible({ timeout: 30_000 })
	})
})

const EULA_MD = /EULA\.[^/?#]+\.md/
const RELEASE_DOWNLOAD = /github\.com\/steve02081504\/fount\/releases\/latest\/download\/(fount\.exe|fount\.sh)/

/**
 * 用仓库内 EULA 文件应答 jsDelivr / GitHub raw。
 * @param {import('npm:@playwright/test').Route} route 拦截到的请求
 * @returns {Promise<void>}
 */
async function fulfillEulaFromRepo(route) {
	expect(route.request().url()).not.toContain('__FOUNT_')
	const match = /EULA\.([^/?#]+)\.md/.exec(route.request().url())
	const locale = match[1]
	const body = await readFile(join(REPO_ROOT, 'docs/EULA', `EULA.${locale}.md`), 'utf8')
	await route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body })
}

/**
 * 打开安装页并进入「打开/安装」路径（跳过已保存主机）。
 * @param {import('npm:@playwright/test').Page} page 页面
 * @param {string} baseUrl Pages 根
 * @param {{ platform?: string, eulaContinueDelayMs?: number }} [options] 平台与倒计时
 * @returns {Promise<void>}
 */
async function openInstallFlow(page, baseUrl, options = {}) {
	const platform = options.platform ?? 'Windows'
	const eulaContinueDelayMs = options.eulaContinueDelayMs ?? 0
	await page.addInitScript(({ platform: uaPlatform, eulaContinueDelayMs: delay }) => {
		Object.defineProperty(navigator, 'userAgentData', {
			configurable: true,
			value: { platform: uaPlatform },
		})
		globalThis.fount ??= {}
		globalThis.fount.test ??= {}
		globalThis.fount.test.forceInstall = true
		globalThis.fount.test.eulaContinueDelayMs = delay
	}, { platform, eulaContinueDelayMs })
	await page.goto(`${baseUrl}/wait/install/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
	await expect(page.locator('#launchButtonSpinner')).toBeHidden()
}

test.describe('install EULA download', () => {
	test('backdrop dismisses only before EULA loads', async ({ page, baseUrl }) => {
		await page.route(EULA_MD, async route => {
			await new Promise(resolve => setTimeout(resolve, 2500))
			await fulfillEulaFromRepo(route)
		})
		await openInstallFlow(page, baseUrl)
		await page.locator('#launchButton').click()
		const dialog = page.locator('#eula-dialog')
		await expect(dialog).toBeVisible()
		await dialog.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } })
		await expect(dialog).toBeHidden()

		await page.locator('#launchButton').click()
		await expect(dialog).toBeVisible()
		await expect(page.locator('#eula-body h1')).toBeVisible({ timeout: 15_000 })
		await dialog.locator('.modal-backdrop').click({ position: { x: 8, y: 8 }, force: true })
		await expect(dialog).toBeVisible()
	})

	test('jsDelivr miss falls back to GitHub raw', async ({ page, baseUrl }) => {
		await page.route(/cdn\.jsdelivr\.net\/gh\/steve02081504\/fount.*EULA/, route => route.abort('aborted'))
		await page.route(/raw\.githubusercontent\.com\/steve02081504\/fount\/.+\/docs\/EULA\//, fulfillEulaFromRepo)
		await openInstallFlow(page, baseUrl)
		await page.locator('#launchButton').click()
		await expect(page.locator('#eula-body h1')).toBeVisible({ timeout: 15_000 })
	})

	test('continue stays disabled until agree after load', async ({ page, baseUrl }) => {
		await page.route(EULA_MD, fulfillEulaFromRepo)
		await openInstallFlow(page, baseUrl, { eulaContinueDelayMs: 2500 })
		await page.locator('#launchButton').click()
		const continueBtn = page.locator('#eula-continue')
		await page.locator('#eula-agree').check()
		await expect(page.locator('#eula-body h1')).toBeVisible({ timeout: 15_000 })
		await expect(continueBtn).toBeDisabled()
		await expect(continueBtn).toBeEnabled({ timeout: 8_000 })
	})

	test('Windows downloads fount.exe', async ({ page, baseUrl }) => {
		await page.route(EULA_MD, fulfillEulaFromRepo)
		/** @type {string[]} */
		const hits = []
		await page.context().route(RELEASE_DOWNLOAD, async route => {
			hits.push(route.request().url())
			await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'ok' })
		})
		await openInstallFlow(page, baseUrl, { platform: 'Windows' })
		await page.locator('#launchButton').click()
		await expect(page.locator('#eula-body h1')).toBeVisible({ timeout: 15_000 })
		await page.locator('#eula-agree').check()
		await page.locator('#eula-continue').click()
		await expect.poll(() => hits.at(-1) || '').toMatch(/\/fount\.exe$/)
	})

	test('non-Windows downloads fount.sh', async ({ page, baseUrl }) => {
		await page.route(EULA_MD, fulfillEulaFromRepo)
		/** @type {string[]} */
		const hits = []
		await page.context().route(RELEASE_DOWNLOAD, async route => {
			hits.push(route.request().url())
			await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'ok' })
		})
		await openInstallFlow(page, baseUrl, { platform: 'Linux' })
		await page.locator('#launchButton').click()
		await expect(page.locator('#eula-body h1')).toBeVisible({ timeout: 15_000 })
		await page.locator('#eula-agree').check()
		await page.locator('#eula-continue').click()
		await expect.poll(() => hits.at(-1) || '').toMatch(/\/fount\.sh$/)
	})
})

const INSTALLER_STATUS = /http:\/\/localhost:8930(?:\/|$|\?)/

/**
 * 拦截本机 runner 状态服务（存活探针 + `/eula` 信令）。
 * @param {import('npm:@playwright/test').Page} page 页面
 * @param {{ eula?: string }} [state] 初始 eula 字段
 * @returns {Promise<{ eulaHits: string[] }>} `/eula` 命中记录
 */
async function mockInstallerStatus(page, state = { eula: 'pending' }) {
	/** @type {string[]} */
	const eulaHits = []
	await page.route(INSTALLER_STATUS, async route => {
		const url = route.request().url()
		const accept = /\/eula(?:\/|$|\?)/.test(url)
		if (accept) {
			eulaHits.push(url)
			state.eula = 'accepted'
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({
				message: accept ? 'accepted' : 'pong',
				eula: state.eula,
			}),
		})
	})
	return { eulaHits }
}

test.describe('install runner wait', () => {
	test('without from=runner, live 8930 stays homepage', async ({ page, baseUrl }) => {
		await mockInstallerStatus(page)
		await openInstallFlow(page, baseUrl)
		await expect(page.locator('#eula-dialog')).toBeHidden()
		await expect(page.locator('#mini-game-section')).toBeHidden()
	})

	test('from=runner shows EULA and signals installer, not download', async ({ page, baseUrl }) => {
		await page.route(EULA_MD, fulfillEulaFromRepo)
		const { eulaHits } = await mockInstallerStatus(page)
		/** @type {string[]} */
		const downloads = []
		await page.context().route(RELEASE_DOWNLOAD, async route => {
			downloads.push(route.request().url())
			await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'ok' })
		})
		await page.addInitScript(() => {
			globalThis.fount ??= {}
			globalThis.fount.test ??= {}
			globalThis.fount.test.eulaContinueDelayMs = 0
		})
		await page.goto(`${baseUrl}/wait/install/?from=runner`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		const dialog = page.locator('#eula-dialog')
		await expect(dialog).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#eula-body h1')).toBeVisible({ timeout: 15_000 })
		await page.locator('#eula-agree').check()
		await page.locator('#eula-continue').click()
		await expect.poll(() => eulaHits.length).toBeGreaterThan(0)
		expect(downloads).toEqual([])
	})

	test('from=runner with prior EULA skips dialog and still signals', async ({ page, baseUrl }) => {
		const { eulaHits } = await mockInstallerStatus(page)
		await page.addInitScript(() => {
			localStorage.setItem('fountEulaAccepted', '1')
		})
		await page.goto(`${baseUrl}/wait/install/?from=runner`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#mini-game-section')).not.toHaveClass(/hidden/, { timeout: 30_000 })
		await expect(page.locator('#eula-dialog')).toBeHidden()
		await expect.poll(() => eulaHits.length).toBeGreaterThan(0)
	})

	test('from=runner retries /eula after 8930 comes up', async ({ page, baseUrl }) => {
		let probes = 0
		let alive = false
		/** @type {string[]} */
		const eulaHits = []
		await page.route(INSTALLER_STATUS, async route => {
			const url = route.request().url()
			const accept = /\/eula(?:\/|$|\?)/.test(url)
			if (!alive) {
				if (!accept) probes++
				if (probes < 3) {
					await route.abort('connectionrefused')
					return
				}
				alive = true
			}
			if (accept) eulaHits.push(url)
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'Access-Control-Allow-Origin': '*' },
				body: JSON.stringify({
					message: accept ? 'accepted' : 'pong',
					eula: accept ? 'accepted' : 'pending',
				}),
			})
		})
		await page.addInitScript(() => {
			localStorage.setItem('fountEulaAccepted', '1')
		})
		await page.goto(`${baseUrl}/wait/install/?from=runner`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		await expect.poll(() => eulaHits.length).toBeGreaterThan(0)
	})

	test('from=runner closes EULA when CLI already accepted', async ({ page, baseUrl }) => {
		await page.route(EULA_MD, fulfillEulaFromRepo)
		await mockInstallerStatus(page, { eula: 'accepted' })
		await page.addInitScript(() => {
			globalThis.fount ??= {}
			globalThis.fount.test ??= {}
			globalThis.fount.test.eulaContinueDelayMs = 0
		})
		await page.goto(`${baseUrl}/wait/install/?from=runner`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#eula-dialog')).toBeHidden({ timeout: 30_000 })
	})
})
