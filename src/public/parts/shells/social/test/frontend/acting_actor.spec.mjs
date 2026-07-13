import { request as playwrightRequest } from '@playwright/test'
import { ms } from 'fount/scripts/ms.mjs'

import { test, expect, openSocialHome } from './fixtures.mjs'

test.describe('Social acting entity switcher', () => {
	test('agent acting loads agent notifications and feed queries', async ({ page, baseUrl, apiKey }) => {
		const api = await playwrightRequest.newContext({
			baseURL: baseUrl,
			extraHTTPHeaders: { 'fount-apikey': apiKey },
		})
		const seed = await api.post('/api/parts/shells:social/test/seed-local-agent', {
			data: { charPartName: 'social_on_message_probe' },
		})
		expect(seed.ok()).toBeTruthy()
		const { entityHash: agentHash } = await seed.json()
		const marker = `agent-acting-${Date.now()}`
		await api.post('/api/parts/shells:social/test/inbox-mention-for', {
			data: { recipientEntityHash: agentHash, snippet: marker, postId: `post-${marker}` },
		})
		await api.dispose()

		await openSocialHome(page, baseUrl)
		const select = page.locator('#actingEntitySelect')
		await expect(select).toBeVisible({ timeout: ms('15s') })
		await select.selectOption(agentHash)

		const notificationsPromise = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			const url = new URL(res.url())
			return url.pathname === '/api/parts/shells:social/notifications'
				&& url.searchParams.get('actingEntityHash') === agentHash
		}, { timeout: ms('30s') })
		await page.locator('[data-view="notifications"]').click()
		const notificationsResponse = await notificationsPromise
		const body = await notificationsResponse.json()
		expect(body.viewerEntityHash).toBe(agentHash)
		expect((body.notifications || []).some(row => String(row.snippet || '').includes(marker))).toBeTruthy()
	})
})
