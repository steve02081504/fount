import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'

import { test, expect, openHome, findPostCard } from './fixtures.mjs'

test.describe('fount.user.send', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openHome(page, baseUrl)
	})

	test('replies to the triggering post through the registered api', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postId } = await publishPost(`fount-user-send trigger ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const authorEntity = await card.getAttribute('data-author-entity')
		expect(authorEntity).toBeTruthy()

		await card.locator('[data-repost]').click()
		await card.locator('[data-repost]').click()

		const replyText = `fount-user-send-reply-${Date.now()}`
		const [sendResponse, sendResult] = await Promise.all([
			page.waitForResponse(res => {
				if (res.request().method() !== 'POST' || res.status() !== 200) return false
				return new URL(res.url()).pathname === '/api/parts/shells:social/posts'
			}, { timeout: 30_000 }),
			page.evaluate(text => globalThis.fount.user.send(text), replyText),
		])

		const sentBody = JSON.parse(sendResponse.request().postData() || '{}')
		expect(sentBody.text).toBe(replyText)
		expect(sentBody.replyTo).toEqual({ entityHash: authorEntity, postId })
		expect(sentBody.visibility).toBe('public')
		expect(sendResult?.event?.id).toBeTruthy()

		const repliesUrl = `${baseUrl}/api/parts/shells:social/profile/${encodeURIComponent(authorEntity)}/replies/${postId}?fount-apikey=${encodeURIComponent(apiKey)}`
		await withApiRequest(async req => {
			for (let attempt = 0; attempt < 40; attempt++) {
				const res = await req.get(repliesUrl)
				if (res.ok()) {
					const data = await res.json()
					if (JSON.stringify(data).includes(replyText)) return
				}
				await new Promise(resolve => setTimeout(resolve, 250))
			}
			throw new Error(`fount.user.send reply not materialized: ${replyText}`)
		})

		const actionKey = await card.locator('[data-replies]').getAttribute('data-replies')
		await card.locator('[data-replies]').click()
		const replyRow = card.locator(`[data-replies-for="${actionKey}"] .reply`)
		await expect(replyRow.first()).toBeVisible({ timeout: 30_000 })
		await expect(replyRow.first().locator('.reply-body')).toContainText(replyText)
	})
})
