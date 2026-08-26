import { fetchViewerEntityHash } from 'fount/scripts/test/playwright/api.mjs'
import { waitForHubReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	navigateGroupChannelHash,
} from './fixtures.mjs'

test.describe('Chat deep links', () => {
	test('hash opens group channel directly', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `deeplink ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'domcontentloaded' })
		await waitForHubReady(page)
		await expect(page.locator('#message-input')).toBeDisabled({ timeout: 60_000 })
		await navigateGroupChannelHash(page, groupId, channelId)
		await expectMessageInChat(page, text)
	})

	test('friends hash opens friends view', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'domcontentloaded' })
		await waitForHubReady(page)
		await expect(page).toHaveURL(/#friends/)
		await expect(page.locator('#server-bar')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('#message-input')).toBeDisabled({ timeout: 60_000 })
	})

	test('char deep link opens friend chat and enables composer', async ({ page, baseUrl }) => {
		// 新用户通过 `?char=` 直达角色好友私聊：应建群、加载消息并启用 composer，
		// 而不是永远停留在 loading spinner（回归：selectChannel 在 friends 模式空返回）。
		await page.goto(`${baseUrl}/parts/shells:chat/hub/?char=on_message_yes`, {
			waitUntil: 'domcontentloaded',
		})
		await waitForHubReady(page)
		await expect(page).toHaveURL(/#group:/, { timeout: 60_000 })
		await expect(page.locator('#message-input')).toBeEnabled({ timeout: 60_000 })
		// 消息区不再停留在 loading
		await expect(page.locator('#messages .loading')).toHaveCount(0, { timeout: 60_000 })
	})

	test('char sidebar shows a non-blank viewer name while async profile loads', async ({ page, baseUrl, apiKey }) => {
		// 回归：角色私聊侧栏的 viewer 成员名依赖异步 `store.viewer.viewerDisplayName`，
		// profile 拉取未完成时渲染为纯空白。需回退到当前群 viewer 成员 displayName。
		// 仅拦截 viewer 自身 profile 请求（用 viewer entityHash 精确匹配，不误拦角色资料请求），
		// 验证空白回退；释放后验证最终态。
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		let releaseProfile
		let viewerProfileIntercepted = false
		let blockedCount = 0
		const profileBlocked = new Promise(resolve => { releaseProfile = resolve })
		await page.route('**/api/parts/shells:chat/entities/*', async route => {
			const { pathname } = new URL(route.request().url())
			const segment = pathname.split('/').filter(Boolean).pop()
			const isViewerProfileGet = route.request().method() === 'GET' && segment === viewerEntityHash
			if (!isViewerProfileGet) {
				await route.continue()
				return
			}
			viewerProfileIntercepted = true
			// 只阻塞首个 viewer 资料请求；重试/后续请求直接放行，避免同 route 二次 continue 竞态。
			if (blockedCount++ > 0) {
				await route.continue()
				return
			}
			await profileBlocked
			// 释放时请求可能已被浏览器中止/重试而提前结算，continue 抛「already handled」属良性，吞掉即可。
			try {
				await route.continue()
			}
			catch (error) {
				if (!String(error?.message).includes('already handled')) throw error
			}
		})

		await page.goto(`${baseUrl}/parts/shells:chat/hub/?char=on_message_yes`, {
			waitUntil: 'domcontentloaded',
		})
		await waitForHubReady(page)
		const viewerItem = page.locator('#member-list .member-item:not([data-char])')
		await expect(viewerItem).toHaveCount(1, { timeout: 60_000 })

		// 确认拦截到的是预期的 viewer 自身资料请求（而非角色资料请求）
		await expect.poll(() => viewerProfileIntercepted).toBe(true)

		// viewer profile 仍 pending：成员名应回退到群成员 displayName，而非空白
		await expect(viewerItem.locator('.member-name')).toHaveText(/\S/, { timeout: 60_000 })

		// 释放 profile 请求，最终展示名仍应为非空白
		releaseProfile()
		await page.unroute('**/api/parts/shells:chat/entities/*')
		await expect(viewerItem.locator('.member-name')).toHaveText(/\S/)
	})
})
