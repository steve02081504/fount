/**
 * gist source 插件渲染：带 source 的 gist 在查看页渲染来源区（描述 + 深链/发送按钮）。
 */
import { test, expect } from './fixtures.mjs'

/**
 * 用 API key 创建带 source 的 gist。
 * @param {import('npm:@playwright/test').APIRequestContext} request - 已登录请求上下文
 * @param {string} baseUrl - 测试根 URL
 * @param {string} apiKey - API 密钥
 * @param {object} source - 来源信息
 * @returns {Promise<string>} gist id
 */
async function createGist(request, baseUrl, apiKey, source) {
	const res = await request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
		headers: { 'fount-apikey': apiKey },
		data: {
			title: `source-${source.type}`,
			markdown: `# ${source.type} source test`,
			securityLevel: 'secure',
			source,
		},
	})
	expect(res.ok(), `create gist failed: ${res.status()}`).toBeTruthy()
	const body = await res.json()
	return body.gist.id
}

test.describe('gist source plugins', () => {
	test('code source gist renders source block with send button', async ({ page, baseUrl, apiKey }) => {
		const id = await createGist(page.request, baseUrl, apiKey, {
			type: 'code',
			ref: { sessionId: 'abc-123', role: 'user' },
			exportedAt: '2026-01-01T00:00:00.000Z',
		})
		await page.goto(`${baseUrl}/parts/shells:gist/view?id=${id}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('.gist-source-code')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('.gist-source-code')).toContainText('abc-123')
		await expect(page.locator('.gist-source-code button')).toContainText('发送到工作区')
	})

	test('code source send button copies markdown when no code context', async ({ page, baseUrl, apiKey }) => {
		const id = await createGist(page.request, baseUrl, apiKey, {
			type: 'code',
			ref: { sessionId: 'abc-456', role: 'user' },
		})
		await page.goto(`${baseUrl}/parts/shells:gist/view?id=${id}`, { waitUntil: 'domcontentloaded' })
		const button = page.locator('.gist-source-code button')
		await expect(button).toBeVisible({ timeout: 30_000 })
		await button.click()
		await expect(page.locator('#toast-container, .toast')).toContainText('已复制', { timeout: 10_000 })
	})

	test('chat source gist renders description and link', async ({ page, baseUrl, apiKey }) => {
		const id = await createGist(page.request, baseUrl, apiKey, {
			type: 'chat',
			ref: { groupId: 'grp-1', channelId: 'ch-1', eventId: 'evt-1', author: 'Alice' },
			exportedAt: '2026-01-01T00:00:00.000Z',
		})
		await page.goto(`${baseUrl}/parts/shells:gist/view?id=${id}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#source-plugins')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#source-plugins')).toContainText('Alice')
	})

	test('social source gist renders description with jump link', async ({ page, baseUrl, apiKey }) => {
		const id = await createGist(page.request, baseUrl, apiKey, {
			type: 'social',
			ref: { entityHash: 'abc123', postId: 'post-9', author: 'Bob' },
			exportedAt: '2026-01-01T00:00:00.000Z',
		})
		await page.goto(`${baseUrl}/parts/shells:gist/view?id=${id}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#source-plugins')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#source-plugins')).toContainText('Bob')
		await expect(page.locator('#source-plugins a')).toHaveAttribute('target', '_blank')
	})
})
