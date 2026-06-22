import { test, expect, openSocialHome } from './fixtures.mjs'

test.describe('Social composer', () => {
	test('publishes a post via composer', async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)

		const text = `playwright e2e ${Date.now()}`
		await page.locator('#postText').fill(text)

		const [postResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/post')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#postBtn').click(),
		])
		const postJson = await postResponse.json()
		expect(postJson.event?.type).toBe('post')
		expect(postJson.event?.content?.text).toBe(text)
		await expect(page.locator('#postText')).toHaveValue('')
	})
})
