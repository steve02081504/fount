/**
 * fount Agent 研究院（blog）：文章列表（分类 / 标签 / 搜索）、正文渲染、语言切换、
 * 站内链接改写与主题切换（含自定义主题兜底）。index.json 由 pages 服务器启动时生成。
 */
import { expect, test } from './fixtures.mjs'

const CARDS = '#article-list article.blog-card'
const VISIBLE_CARDS = `${CARDS}:not(.hidden)`

/**
 * 读取搜索框当前值。
 * @param {import('npm:@playwright/test').Page} page 页
 * @returns {Promise<string>} 搜索框值
 */
const searchValue = page => page.evaluate(() => document.getElementById('article-search').value)

test.describe('agent institute', () => {
	test('index groups articles by category with tags', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main h1')).toContainText('fount Agent 研究院', { timeout: 30_000 })
		const cards = page.locator(CARDS)
		await expect(cards).toHaveCount(11, { timeout: 30_000 })
		// 分类目录：guide × 1 + foundation × 2 + context × 2 + economics × 2 + safety × 3 + practice × 1
		const headings = page.locator('#article-list h2')
		await expect(headings).toHaveText(['阅读指南', '定义与架构', '上下文工程', '成本与验证', '安全与信任', 'fount 实践'])
		await expect(cards.first().locator('h3')).toContainText('从哪里读起')
		await expect(cards.nth(10).locator('h3')).toContainText('构建 fount Shell')
		// 标签来自 frontmatter，点击填入搜索框
		const tag = cards.first().locator('.blog-tag-badge').first()
		await expect(tag).toBeVisible()
		await tag.click()
		await expect.poll(() => searchValue(page)).toBe(await tag.textContent())
	})

	test('search filters cards by title, summary and tags', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator(CARDS)).toHaveCount(11, { timeout: 30_000 })
		const search = page.locator('#article-search')
		await search.fill('角色扮演')
		await expect(page.locator(VISIBLE_CARDS)).toHaveCount(1)
		await expect(page.locator(VISIBLE_CARDS).first().locator('h3')).toContainText('角色扮演会让 LLM 干不好正事吗？')
		// 无结果提示
		await search.fill('不存在的关键词xyzzy')
		await expect(page.locator('#search-empty')).toBeVisible()
		// 清空恢复
		await search.fill('')
		await expect(page.locator(VISIBLE_CARDS)).toHaveCount(11)
		await expect(page.locator('#search-empty')).toBeHidden()
	})

	test('card click opens the article in the preferred language', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/`, { waitUntil: 'domcontentloaded' })
		const firstTitle = page.locator(`${CARDS} h3 a`).first()
		await expect(firstTitle).toBeVisible({ timeout: 30_000 })
		await firstTitle.click()
		await expect(page).toHaveURL(/\/blog\/article\/\?article=reading-guide&lang=zh-CN$/)
		await expect(page.locator('#article-body h1')).toHaveText('从哪里读起', { timeout: 30_000 })
		await expect(page.locator('#article-pager')).toBeVisible()
	})

	test('language menu lists only available languages and switches', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/article/?article=agents-are-not-chatbots&lang=zh-CN`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#article-body h1')).toHaveText('为什么 fount 的 Agent 不是聊天机器人', { timeout: 30_000 })
		await page.locator('#language-dropdown .btn').click()
		const items = page.locator('#language-menu button')
		await expect(items).toHaveCount(2)
		await items.filter({ hasText: 'English (UK)' }).click()
		await expect(page).toHaveURL(/lang=en-UK$/)
		await expect(page.locator('#article-body h1')).toHaveText('Why fount Agents Are Not Chatbots', { timeout: 30_000 })
	})

	test('in-article links point to sibling articles keeping the language', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/article/?article=llm-is-not-the-agent&lang=zh-CN`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#article-body h1')).toHaveText('LLM 不是 Agent', { timeout: 30_000 })
		const link = page.locator('#article-body a[href*="article=agents-are-not-chatbots"]').first()
		await expect(link).toBeVisible()
		await link.click()
		await expect(page).toHaveURL(/article=agents-are-not-chatbots&lang=zh-CN/)
		await expect(page.locator('#article-body h1')).toHaveText('为什么 fount 的 Agent 不是聊天机器人', { timeout: 30_000 })
	})

	test('article strips YAML frontmatter before rendering', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/article/?article=agents-are-not-chatbots&lang=zh-CN`, { waitUntil: 'domcontentloaded' })
		const body = page.locator('#article-body')
		await expect(body.locator('h1').first()).toHaveText('为什么 fount 的 Agent 不是聊天机器人', { timeout: 30_000 })
		await expect(body).not.toContainText('title:')
		await expect(body).not.toContainText('summary:')
		await expect(body).not.toContainText('tags:')
		await expect.poll(() => body.evaluate(el => el.firstElementChild?.tagName)).toBe('H1')
	})

	test('article shows a wiki-like sidebar with table of contents and all-articles nav', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/blog/article/?article=agents-are-not-chatbots&lang=zh-CN`, { waitUntil: 'domcontentloaded' })
		const sidebar = page.locator('#article-sidebar')
		await expect(sidebar).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#article-toc-section')).toBeVisible()
		// 语种轮换会临时隐藏 user-content 正文引起布局塌缩（滚动复位），滚动断言前冻结
		await page.evaluate(() => globalThis.fount.test.watch.holdLocale())

		// 目录条目与正文 h2/h3 一一对应
		const tocLinks = page.locator('#article-toc .blog-toc-link')
		const headings = page.locator('#article-body h2, #article-body h3')
		await expect(tocLinks).toHaveCount(await headings.count())
		await expect(tocLinks.first()).toHaveText((await headings.first().textContent()).trim())

		// 标题获得 GitHub 风格锚点 id
		await expect(headings.first()).toHaveAttribute('id', /./)

		// 点击目录条目：URL 带上锚点并滚动高亮
		const target = tocLinks.nth(2)
		const href = await target.getAttribute('href')
		await target.click()
		await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe(href)
		await expect.poll(() => page.evaluate(() => {
			const active = document.querySelector('#article-toc .blog-toc-active')
			return active?.getAttribute('href') || ''
		})).toBe(href)

		// 全部文章导航：分类分组、11 篇全列出、当前文章高亮
		await expect(page.locator('#article-nav .blog-nav-link')).toHaveCount(11)
		await expect(page.locator('#article-nav .blog-nav-active')).toHaveCount(1)
		await expect(page.locator('#article-nav .blog-nav-active')).toHaveText('为什么 fount 的 Agent 不是聊天机器人')
	})

	test('iconify icons load without 4xx', async ({ page, baseUrl }) => {
		/** @type {string[]} */
		const badIcons = []
		/** @type {number[]} */
		const iconifyStatuses = []
		page.on('response', res => {
			if (!res.url().includes('api.iconify.design')) return
			iconifyStatuses.push(res.status())
			if (res.status() >= 400) badIcons.push(res.url())
		})
		await page.goto(`${baseUrl}/blog/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator(CARDS).first()).toBeVisible({ timeout: 30_000 })
		// 首页的主题图标确实请求过且成功
		await expect.poll(() => iconifyStatuses.length).toBeGreaterThan(0)
		await page.goto(`${baseUrl}/blog/article/?article=agents-are-not-chatbots&lang=zh-CN`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#article-body h1').first()).toHaveText('为什么 fount 的 Agent 不是聊天机器人', { timeout: 30_000 })
		// 语言 + 主题图标也成功
		await expect.poll(() => iconifyStatuses.length).toBeGreaterThan(2)
		expect(badIcons).toEqual([])
	})

	test('theme menu handles custom themes without errors', async ({ page, baseUrl }) => {
		await page.addInitScript(() => {
			localStorage.setItem('fountTheme', 'dark')
			localStorage.setItem('fountCustomThemeName', 'my-theme')
			localStorage.setItem(
				'fountCustomThemeCss',
				'[data-theme="my-theme"] { color-scheme: light; --color-base-100: oklch(0.92 0.05 200); }',
			)
		})
		await page.goto(`${baseUrl}/blog/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator(CARDS).first()).toBeVisible({ timeout: 30_000 })

		await page.locator('header .dropdown .btn').click()
		const items = page.locator('#theme-menu button')
		const customItem = items.filter({ hasText: 'my-theme' })
		await expect(customItem).toHaveCount(1)

		// 切到内置主题：data-theme 离开自定义主题，自定义样式被移除
		const builtin = items.nth(1)
		await builtin.click()
		await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe('my-theme')
		await expect(page.locator('#custom-theme-style')).toHaveCount(0)

		// 再切回自定义主题：样式重新注入，全程无报错
		await page.locator('header .dropdown .btn').click()
		await customItem.click()
		await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('my-theme')
		await expect(page.locator('#custom-theme-style')).toHaveCount(1)
	})
})
