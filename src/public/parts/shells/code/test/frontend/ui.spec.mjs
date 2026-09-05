/**
 * code shell 前端 UI 测试：placeholder 回归、pill 下拉（mode / AI 源 / 角色）、shell 模式（! 移除/历史/影子补全）、
 * 消息发送、工作区选择、工作区角色覆盖/推荐、顶部会话选择器。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { test, expect } from './fixtures.mjs'

const BASE = '/parts/shells:code/'
const API_BASE = '/api/parts/shells:code'
/** 隔离测试用户名（run.mjs testUsername）对应的 localStorage 偏好前缀。 */
const PREF_PREFIX = 'code.shell.code-fe-user.'

/**
 * 打开 code shell 页面并等待 composer 就绪与 boot 完成（boot 末步聚焦 composer）。
 * 先清空后端标签页，避免跨测试残留（标签/草稿现存储在后端 shell data）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @returns {Promise<void>}
 */
async function openCode(page, baseUrl) {
	await page.request.put(`${baseUrl}${API_BASE}/tabs`, { data: { tabs: [], activeTab: '' } })
	await page.goto(`${baseUrl}${BASE}`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
	// boot 在加载完角色/工作区/会话后聚焦 composer；等焦点落定避免后续点击与 boot 竞态
	await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
}

/**
 * 在临时目录创建含指定文件的工作区。
 * @param {string} name - 工作区名。
 * @param {Record<string, string>} files - 相对路径 → 内容。
 * @returns {string} 目录路径。
 */
function makeWorkspace(name, files = {}) {
	const dir = mkdtempSync(join(tmpdir(), `fount-code-${name}-`))
	for (const [rel, content] of Object.entries(files)) {
		const full = join(dir, rel)
		mkdirSync(dirname(full), { recursive: true })
		writeFileSync(full, content)
	}
	return dir
}

/**
 * 经文件夹浏览器选定目录为工作区。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} dir - 目录路径。
 * @returns {Promise<void>}
 */
async function selectWorkspaceViaBrowser(page, dir) {
	await page.locator('#workspace-pill').click()
	await page.locator('#workspace-menu').getByText('浏览…').click()
	await page.locator('#folder-path-input').fill(dir)
	await page.locator('#folder-select-button').click()
	await expect(page.locator('#workspace-pill-label')).toContainText(basename(dir))
}

/**
 * 移除当前工作区。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
async function removeCurrentWorkspace(page) {
	await page.locator('#workspace-pill').click()
	await page.locator('#workspace-menu').getByText('移除当前工作区').click()
	await expect(page.locator('#workspace-pill-label')).toContainText('未选择工作区')
}

test.describe('code shell composer & placeholders', () => {
	test('composer placeholder stays on normal message text after blur and refocus', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toContainText('输入消息开始')
		// 点外部可聚焦元素（home 总览按钮）再点回输入框：占位符不应被旧 i18n 文案（输入命令，Enter 执行…）覆盖
		await page.locator('#home-toggle').click()
		await expect(composer).not.toBeFocused()
		await composer.click()
		await expect(placeholder).toContainText('输入消息开始')
		await expect(placeholder).not.toContainText('输入命令')
	})

	test('shell mode swaps the placeholder, removes ！, and Backspace on empty exits', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toContainText('输入消息开始')
		await composer.click()
		await page.keyboard.type('！')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		// shell pill 顶格：淡出的其他选择器不再把 shell pill 挤到中间
		const controlsBox = await page.locator('.code-composer-controls-main').boundingBox()
		const shellBox = await page.locator('#shell-pill-wrap').boundingBox()
		expect(shellBox.x - controlsBox.x).toBeLessThan(8)
		// 叹号被移除，输入框为空 → shell 占位符显示
		await expect(placeholder).toContainText('输入 shell 命令')
		// 输入内容后再删到空：不退出 shell 模式
		await page.keyboard.type('echo hi')
		await expect(placeholder).toHaveCount(0)
		await page.keyboard.press('Control+A')
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		await expect(placeholder).toContainText('输入 shell 命令')
		// 空内容再按 Backspace：退出 shell 模式
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeHidden()
		await expect(placeholder).toContainText('输入消息开始')
		await expect(placeholder).not.toContainText('输入命令')
	})

	test('! shell command executes and renders output bubbles', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('！echo hello-code-shell')
		await page.locator('#send-button').click()
		await expect(page.locator('.code-message.role-user')).toContainText('echo hello-code-shell')
		await expect(page.locator('.code-message.role-tool')).toContainText('hello-code-shell')
		// 用户 shell 结果默认展开
		await expect(page.locator('.code-message.role-tool details.code-tool-log[open]')).toHaveCount(1)
		// 用户气泡靠右（flex 交叉轴 auto margin 不再压过 align-self）
		const messagesBox = await page.locator('#messages').boundingBox()
		const userBox = await page.locator('.code-message.role-user').boundingBox()
		expect(userBox.x + userBox.width).toBeGreaterThan(messagesBox.x + messagesBox.width * 0.75)
		// 发送后保持 shell 模式，可直接连续执行命令
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		await composer.click()
		await page.keyboard.type('echo again-code-shell')
		await page.locator('#send-button').click()
		await expect(page.locator('.code-message.role-tool').last()).toContainText('again-code-shell')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
	})

	test('shell history: ↑/↓ navigates own history, ghost suggestion accepts via Tab', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await composer.click()
		await page.keyboard.type('！')
		await page.keyboard.type('echo hello-code-shell')
		await page.locator('#send-button').click()
		await expect(page.locator('.code-message.role-tool')).toContainText('hello-code-shell')
		// 发送后仍处于 shell 模式：直接 ↑ 遍历自有历史
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		await composer.click()
		await page.keyboard.press('ArrowUp')
		await expect(composer).toContainText('echo hello-code-shell')
		// ↓ 恢复草稿（空）
		await page.keyboard.press('ArrowDown')
		await expect(placeholder).toContainText('输入 shell 命令')
		// 影子补全 + Tab 接受
		await page.keyboard.type('echo h')
		await expect(page.locator('.code-composer-ghost')).toContainText('ello-code-shell')
		await page.keyboard.press('Tab')
		await expect(composer).toContainText('echo hello-code-shell')
		// 清空后 Backspace 退出 shell 模式
		await page.keyboard.press('Control+A')
		await page.keyboard.press('Backspace')
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeHidden()
	})

	test('Ctrl+Enter sends a message and renders the char reply', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('你好')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-user')).toContainText('你好', { timeout: 60_000 })
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
	})
})

test.describe('code shell pill dropdowns', () => {
	test('mode dropdown opens, lists plan/build, and switching updates the pill', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#mode-pill-label')).toHaveText('build')
		await page.locator('#mode-pill').click()
		const menu = page.locator('#mode-menu')
		await expect(menu).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: 'plan' })).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: 'build' })).toBeVisible()
		await menu.locator('.menu-item', { hasText: 'plan' }).click()
		await expect(page.locator('#mode-pill-label')).toHaveText('plan')
	})

	test('Tab in the composer cycles the mode with toast feedback', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#mode-pill-label')).toHaveText('build')
		await page.locator('#composer-input').click()
		await page.keyboard.press('Tab')
		await expect(page.locator('#mode-pill-label')).toHaveText('plan')
		await expect(page.locator('#toast-container')).toContainText('已切换到 plan 模式')
	})

	test('ai source dropdown opens, lists sources, and selecting updates the pill', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#ai-source-pill-label')).toHaveText('角色自带')
		await page.locator('#ai-source-pill').click()
		const menu = page.locator('#ai-source-menu')
		await expect(menu).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: 'stubAI' })).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: '角色自带' })).toBeVisible()
		await menu.locator('.menu-item', { hasText: 'stubAI' }).click()
		await expect(page.locator('#ai-source-pill-label')).toHaveText('stubAI')
		// 切回角色自带
		await page.locator('#ai-source-pill').click()
		await expect(page.locator('#ai-source-menu')).toBeVisible()
		await page.locator('#ai-source-menu').locator('.menu-item', { hasText: '角色自带' }).click()
		await expect(page.locator('#ai-source-pill-label')).toHaveText('角色自带')
	})

	test('char switch dialog lists available chars and switching updates the pill', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		await expect(page.locator('#char-pill-label')).toHaveText('codeBuddy')
		await page.locator('#char-pill').click()
		await expect(page.locator('#char-switch-button')).toBeVisible()
		await page.locator('#char-switch-button').click()
		const dialog = page.locator('dialog.modal:has(#char-switch-list)')
		await expect(dialog).toBeVisible()
		const list = dialog.locator('#char-switch-list')
		await expect(list.locator('.char-option')).toHaveCount(2)
		await expect(list.locator('.char-option', { hasText: 'codeBuddy' })).toBeVisible()
		await expect(list.locator('.char-option', { hasText: 'testAgent' })).toBeVisible()
		await list.locator('.char-option', { hasText: 'testAgent' }).click()
		await expect(dialog).toBeHidden()
		await expect(page.locator('#char-pill-label')).toHaveText('testAgent')
	})
})

test.describe('code shell sessions & workspace', () => {
	test('new tab button opens a new draft tab on each click', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
		await page.locator('#new-tab-button').click()
		// 每次点击都新建草稿标签（允许多个未发送草稿标签并存），而非复用当前空草稿
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
		await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
		await page.locator('#new-tab-button').click()
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(3)
	})

	test('selecting a workspace via the folder browser enables the coding session flow', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-'))
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			// 无会话条目 → 保持空态（wordmark 居中）
			await expect(page.locator('.code-main')).toHaveClass(/empty-mode/)
			// home 总览菜单按工作区分组
			await page.locator('#home-toggle').click()
			await expect(page.locator('#home-menu')).toContainText(basename(dir))
			await expect(page.locator('#home-menu')).toContainText('暂无会话')
			await page.mouse.click(10, 300)
			// 清理：移除工作区，避免污染同相位后续测试
			await removeCurrentWorkspace(page)
		}
		finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test('workspace .agents/fount/code.json overrides the selected character when installed', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-char', { '.agents/fount/code.json': JSON.stringify({ char: { partname: 'codeBuddy' } }) })
		try {
			await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'testAgent'), PREF_PREFIX)
			await openCode(page, baseUrl)
			await expect(page.locator('#char-pill-label')).toHaveText('testAgent')
			await selectWorkspaceViaBrowser(page, dir)
			await expect(page.locator('#char-pill-label')).toHaveText('codeBuddy')
			await removeCurrentWorkspace(page)
		}
		finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test('uninstalled recommended char shows a dismissible bottom-right card', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-rec', { '.agents/fount/code.json': JSON.stringify({ char: { partname: 'GhostCharNotInstalled', install_url: 'x' } }) })
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await expect(page.locator('.code-char-recommend')).toBeVisible()
			await expect(page.locator('.code-char-recommend-text')).toContainText('GhostCharNotInstalled')
			await page.locator('.code-char-recommend .btn-ghost').click()
			await expect(page.locator('.code-char-recommend')).toBeHidden()
			await removeCurrentWorkspace(page)
		}
		finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

test.describe('code shell tabs', () => {
	test('tabs: draft → session conversion, switching, closing, and home menu opening', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-tabs-'))
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
			// 执行 shell 命令 → 草稿落盘转为会话标签（标题未命名会话）
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo tab-lifecycle')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('tab-lifecycle')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			// 会话标签带工作区头像（非草稿铅笔图标）
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-avatar:not(.code-tab-avatar-draft)')).toBeVisible()
			// + 新建草稿标签
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
			// 新草稿绑定同一工作区，且为空态布局
			await expect(page.locator('.code-main')).toHaveClass(/empty-mode/)
			// 点会话标签切回（消息流恢复）
			await page.locator('#tab-strip .code-tab', { hasText: '未命名会话' }).click()
			await expect(page.locator('.code-message.role-tool')).toContainText('tab-lifecycle')
			await expect(page.locator('.code-main')).not.toHaveClass(/empty-mode/)
			// home 总览菜单列出该会话，点击打开（已开 → 聚焦）
			await page.locator('#home-toggle').click()
			const menuItem = page.locator('#home-menu').locator('.menu-item', { hasText: '未命名会话' })
			await expect(menuItem).toBeVisible()
			await menuItem.click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			// 关闭当前活动草稿标签 → 切回相邻会话标签
			await page.locator('#tab-strip .code-tab', { hasText: '新会话' }).locator('.code-tab-close').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			// Alt+T 新建 / Alt+1 切换（浏览器保留键无法拦截，键绑用 Alt 系）
			await page.keyboard.press('Alt+t')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await page.keyboard.press('Alt+1')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			// 清理：移除工作区，避免污染同相位后续测试
			await removeCurrentWorkspace(page)
		}
		finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test('unsent drafts persist per-tab and across reload (backend tabs)', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-draft-'))
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('draft A')
			// 第二个草稿标签 + 不同的未发送内容
			await page.locator('#new-tab-button').click()
			await page.locator('#composer-input').click()
			await page.keyboard.type('draft B')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			// 等后端防抖落盘后刷新，标签列表与活动草稿内容应从后端恢复
			await page.waitForTimeout(800)
			await page.reload({ waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(composer).toContainText('draft B')
			// 切回第一个草稿标签，其未发送内容恢复为 A
			await page.locator('#tab-strip .code-tab').first().click()
			await expect(composer).toContainText('draft A')
			// 清理：移除工作区，避免污染同相位后续测试
			await removeCurrentWorkspace(page)
		}
		finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})