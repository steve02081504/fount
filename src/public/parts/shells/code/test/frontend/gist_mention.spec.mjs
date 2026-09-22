/**
 * code shell 前端 UI 测试：@ gist 提及自动补全与正文附件。
 */
import { test, expect } from './fixtures.mjs'
import { holdLocale, openCode, PREF_PREFIX, releaseLocale } from './helpers.mjs'

test.describe('code shell @ gist mention', () => {
	test('@ autocompletes gists, inserts a token, and attaches the gist body on send', async ({ page, baseUrl }) => {
		const gistTitle = `gist-mention-${Date.now()}`
		const gistBody = `# ${gistTitle}\n\ngist-body-marker`
		const created = await (await page.request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
			data: { markdown: gistBody, title: gistTitle, securityLevel: 'trusted' },
		})).json()
		const gistId = created.gist.id
		try {
			await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
			await openCode(page, baseUrl)
			const composer = page.locator('#composer-input')
			await composer.click()
			await holdLocale(page)
			try {
				await page.keyboard.type('@' + gistTitle)
				const option = page.locator('.mention-panel .mention-option', { hasText: gistTitle })
				await expect(option).toBeVisible()
				await option.click()
			}
			finally {
				await releaseLocale(page)
			}
			// chip 显示 gist 标题，底层原文为 @[gist:id]
			await expect(composer).toContainText(gistTitle)
			const rawToken = await composer.locator('.fount-markdown-rich-input-chip').first().getAttribute('data-raw')
			expect(rawToken).toBe(`@[gist:${gistId}]`)
			await page.keyboard.press('Control+Enter')
			// 正文作为附件并入用户消息（气泡渲染附件 chip）；不依赖后续角色生成链
			const userBubble = page.locator('.code-message.role-user')
			await expect(userBubble).toContainText(gistTitle, { timeout: 60_000 })
			await expect(userBubble).toContainText(`${gistTitle}.md`)
		}
		finally {
			await page.request.post(`${baseUrl}/api/parts/shells:gist/gists/batch-delete`, { data: { ids: [gistId] } })
		}
	})
})
