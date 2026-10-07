import { test, expect } from './fixtures.mjs'

const invitationApi = '**/api/parts/shells:home/invitation'
const link = `http://localhost:8931/parts/shells:chat/hub/?contact=${'a'.repeat(128)}`

test('invitation errors show backend details as text and a retry clears them', async ({ page, baseUrl }) => {
	const detail = 'Inviter profile unavailable <img src=x onerror="window.invitationErrorExecuted=true">'
	let posts = 0
	await page.route(invitationApi, async route => {
		if (route.request().method() === 'POST') {
			expect(route.request().postDataJSON()).toEqual({ link })
			posts++
			await route.fulfill({ status: posts === 1 ? 400 : 200, json: posts === 1 ? { error: detail } : { pending: true } })
		}
		else await route.fulfill({ json: { invited: false, pending: posts > 1 } })
	})
	const ready = page.waitForResponse(response => response.url().endsWith('/api/parts/shells:home/invitation'))
	await page.goto(`${baseUrl}/invitation-required/`, { waitUntil: 'domcontentloaded' })
	await ready
	await expect(page.locator('#invitation-link')).toBeVisible()
	await page.locator('#invitation-link').fill(link)
	await page.locator('#invitation-submit').click()
	await expect(page.locator('#invitation-error')).toHaveText(`HTTP 400: ${detail}`)
	await expect(page.locator('#invitation-error img')).toHaveCount(0)
	expect(await page.evaluate(() => window.invitationErrorExecuted)).toBeUndefined()
	await expect(page.locator('#invitation-submit')).toBeEnabled()
	await page.locator('#invitation-submit').click()
	await expect(page.locator('#invitation-error')).toBeHidden()
	await expect(page.locator('#invitation-error')).toHaveText('')
	await expect(page.locator('#invitation-status')).toContainText('等待对方确认')
})

test('initial invitation status failures preserve HTTP status for non-JSON responses', async ({ page, baseUrl }) => {
	await page.route(invitationApi, route => route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }))
	await page.goto(`${baseUrl}/invitation-required/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#invitation-error')).toBeVisible()
	await expect(page.locator('#invitation-error')).toContainText('HTTP 502:')
	await expect(page.locator('#invitation-submit')).toBeEnabled()
})

test('pending invitation polling shows its error and clears it after recovery', async ({ page, baseUrl }) => {
	let reads = 0
	await page.route(invitationApi, route => {
		reads++
		return route.fulfill({ status: reads === 2 ? 503 : 200, json: reads === 2
			? { error: 'Inviter node is unreachable' } : { invited: false, pending: true } })
	})
	await page.goto(`${baseUrl}/invitation-required/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#invitation-error')).toHaveText('HTTP 503: Inviter node is unreachable', { timeout: 15_000 })
	await expect(page.locator('#invitation-error')).toBeHidden({ timeout: 15_000 })
	await expect(page.locator('#invitation-status')).toContainText('等待对方确认')
})
