import { waitForSocialAppReady } from 'fount/scripts/test/playwright/ready.mjs'

import { test, expect, openSocialHome, expectPostInFeed } from './fixtures.mjs'

test.describe('Social navigation', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('switches between main views', async ({ page }) => {
		const views = [
			{ name: 'explore', selector: '#exploreView' },
			{ name: 'notifications', selector: '#notificationsView' },
			{ name: 'saved', selector: '#savedView' },
			{ name: 'profile', selector: '#profileView' },
			{ name: 'feed', selector: '#feedView' },
		]

		for (const { name, selector } of views) {
			await page.locator(`.side-nav .nav-btn[data-view="${name}"]`).click()
			await expect(page.locator(selector)).toBeVisible()
			await expect(page).toHaveURL(new RegExp(`#${name}$`))
			if (name === 'feed')
				await expect(page.locator('#composer')).toBeVisible()
			else
				await expect(page.locator('#composer')).toBeHidden()
		}
	})

	test('refresh restores active nav tab from hash', async ({ page }) => {
		await page.locator('.side-nav .nav-btn[data-view="explore"]').click()
		await expect(page.locator('#exploreView')).toBeVisible()
		await expect(page).toHaveURL(/#explore$/)
		await page.reload()
		await waitForSocialAppReady(page)
		await expect(page.locator('#exploreView')).toBeVisible({ timeout: 60_000 })
		await expect(page).toHaveURL(/#explore$/)
	})

	test('videos view opens fullscreen and shows empty state', async ({ page }) => {
		const feedPromise = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/videos/feed'
		}, { timeout: 60_000 })
		await page.locator('.side-nav .nav-btn[data-view="videos"]').click()
		await feedPromise
		await expect(page.locator('#videosView')).toBeVisible()
		await expect(page.locator('#composer')).toBeHidden()
		await expect(page.locator('#videosView .video-empty-state')).toBeVisible()
		await expect(page.locator('#videosView .video-empty-title')).toHaveText('暂无短视频')
		await page.locator('#videosView [data-video-compose]').click()
		await expect(page.locator('#feedView')).toBeVisible()
		await expect(page.locator('#composer')).toBeVisible()
	})

	test('feed search filters posts and clear restores feed', async ({ page, publishPost }) => {
		const tag = `navsrch${Date.now()}`
		const { postId } = await publishPost(`nav-filter #${tag}`)
		await expect(page.locator(`#feedView [data-post-id="${postId}"]`).first()).toBeVisible({ timeout: 60_000 })

		const input = page.locator('#feedSearchInput')
		await input.fill(`#${tag}`)
		await input.press('Enter')
		await expect(page.locator('#feedSearchClearButton')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`).first()).toBeVisible({ timeout: 30_000 })

		await input.fill(`__no-match-${Date.now()}__`)
		await input.press('Enter')
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toHaveCount(0, { timeout: 30_000 })

		await page.locator('#feedSearchClearButton').click()
		await expect(input).toHaveValue('')
		await expectPostInFeed(page, postId)
	})
})
