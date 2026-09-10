/**
 * code shell 前端 UI 测试：placeholder 回归、pill 下拉（mode / AI 源 / 角色）、shell 模式（! 移除/历史/影子补全）、
 * 消息发送、工作区选择、工作区角色覆盖/推荐、顶部会话选择器。
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
 * 删除临时目录（Windows 上会话 flush / Defender 瞬时占用文件句柄使 rmSync 偶发失败，重试摊平竞态）。
 * @param {string} dir - 目录路径。
 * @param {number} [attempts=20] - 重试次数（间隔 250ms，默认覆盖 5s 的后端落盘窗口）。
 * @returns {Promise<void>}
 */
async function rmDirRetry(dir, attempts = 20) {
	for (let attempt = 0; attempt < attempts; attempt++) try {
		rmSync(dir, { recursive: true, force: true })
		return
	}
	catch (error) {
		if (attempt === attempts - 1) throw error
		await new Promise(resolve => setTimeout(resolve, 250))
	}
}

/** 需在 context 关闭后清理的工作区目录集（页面关闭时的会话 flush 会重建已删除的 session 文件）。 */
const leftoverWorkspaceDirs = new Set()

// afterAll 在所有测试与 fixture teardown（页面关闭触发 beforeunload flush）之后运行，此时删除不会被 flush 重建
test.afterAll(async () => {
	for (const dir of leftoverWorkspaceDirs)
		await rmDirRetry(dir)
	leftoverWorkspaceDirs.clear()
})

/**
 * 挂起 page watch 的 locale 轮换（每秒整页重建与下拉点击竞态，flake 源）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
async function holdLocale(page) {
	await page.evaluate(() => globalThis.fount?.test?.watch?.holdLocale?.())
}

/**
 * 恢复 locale 轮换。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
async function releaseLocale(page) {
	await page.evaluate(() => globalThis.fount?.test?.watch?.releaseLocale?.())
}

/**
 * 经文件夹浏览器选定目录为工作区。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} dir - 目录路径。
 * @returns {Promise<void>}
 */
async function selectWorkspaceViaBrowser(page, dir) {
	await holdLocale(page)
	try {
		await page.locator('#workspace-pill').click()
		await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
	}
	finally {
		await releaseLocale(page)
	}
	await page.locator('#folder-path-input').fill(dir)
	await page.locator('#folder-select-button').click()
	await expect(page.locator('#workspace-pill-label')).toContainText(basename(dir))
}

/**
 * 经 API 移除全部已保存工作区（UI 移除依赖下拉点击，历史上与整页重建/布局抖动竞态 flaky；清理走确定性 API）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @returns {Promise<void>}
 */
async function removeAllWorkspacesViaApi(page, baseUrl) {
	const { list } = await (await page.request.get(`${baseUrl}${API_BASE}/workspaces`)).json()
	for (const workspace of list || []) {
		const deleteResponse = await page.request.delete(`${baseUrl}${API_BASE}/workspaces/${workspace.id}`)
		if (!deleteResponse.ok()) throw new Error(`failed to remove workspace ${workspace.id}: ${deleteResponse.status()} ${deleteResponse.statusText()}`)
	}
}

test.describe('code shell composer & placeholders', () => {
	test('composer placeholder stays on normal message text after blur and refocus', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toContainText('输入消息开始')
		// 点外部可聚焦元素（发送按钮）再点回输入框：占位符不应被旧 i18n 文案（输入命令，Enter 执行…）覆盖
		await page.locator('#send-button').click()
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

	test('user message echoes immediately while generation is still streaming', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('立即回显')
		await page.keyboard.press('Control+Enter')
		// streamAgent 每片 800ms；生成中气泡仍在时用户消息已可见 → 乐观回显（未等 done 回传）
		await expect(page.locator('.code-message.role-user')).toContainText('立即回显', { timeout: 5_000 })
		await expect(page.locator('.code-message.generating')).toBeVisible()
		await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText('流式第一段。流式第二段。', { timeout: 60_000 })
	})

	test('streaming preview fills the generating bubble progressively, then final entry replaces it', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('流式测试')
		await page.keyboard.press('Control+Enter')
		// 生成中气泡出现，且随 preview 增长显示第一段（后续 chunk 在 ~800ms 后到达）
		const generating = page.locator('.code-message.generating .code-message-body')
		await expect(generating).toBeVisible({ timeout: 60_000 })
		await expect(generating).toContainText('流式第一', { timeout: 60_000 })
		// 完成后正式气泡替换生成中气泡
		await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText('流式第一段。流式第二段。', { timeout: 60_000 })
		await expect(page.locator('.code-message.generating')).toHaveCount(0)
	})

	test('streaming via AI source StructCall reaches the generating bubble', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		// 挂起 locale 轮换（每秒整页重建会使下拉与点击竞态）
		await holdLocale(page)
		try {
			// 请求级 AI 源选 stubAI：角色走 StructCall 委托路径
			await page.locator('#ai-source-pill').click()
			await page.locator('#ai-source-menu').locator('.menu-item', { hasText: 'stubAI' }).click()
			await expect(page.locator('#ai-source-pill-label')).toHaveText('stubAI')
		}
		finally {
			await releaseLocale(page)
		}
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('流式测试 AI 源')
		await page.keyboard.press('Control+Enter')
		const generating = page.locator('.code-message.generating .code-message-body')
		await expect(generating).toBeVisible({ timeout: 60_000 })
		await expect(generating).toContainText('stub 流式第一', { timeout: 60_000 })
		await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText('stub 流式第一段。stub 流式第二段。', { timeout: 60_000 })
		await expect(page.locator('.code-message.generating')).toHaveCount(0)
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
		// toast 文案经 data-i18n 随 locale 轮换实时翻译，断言 locale 无关的模式名
		await expect(page.locator('#toast-container')).toContainText('plan')
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
		await expect(list.locator('.char-option')).toHaveCount(3)
		await expect(list.locator('.char-option', { hasText: 'codeBuddy' })).toBeVisible()
		await expect(list.locator('.char-option', { hasText: 'testAgent' })).toBeVisible()
		await expect(list.locator('.char-option', { hasText: 'streamAgent' })).toBeVisible()
		await list.locator('.char-option', { hasText: 'testAgent' }).click()
		await expect(dialog).toBeHidden()
		await expect(page.locator('#char-pill-label')).toHaveText('testAgent')
		// 发送一条消息，按回复内容验证切换已生效（testAgent 与 codeBuddy 的回复文案不同）
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('切换验证')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-user')).toContainText('切换验证', { timeout: 60_000 })
		await expect(page.locator('.code-message.role-char')).toContainText('我是 testAgent，角色切换验证。', { timeout: 60_000 })
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
			// home 总览弹窗：左栏工作区列表含该目录，右栏显示空态
			await page.locator('#home-toggle').click()
			await expect(page.locator('#home-workspace-list')).toContainText(basename(dir))
			await expect(page.locator('#home-session-list')).toContainText('暂无会话')
			await page.keyboard.press('Escape')
			// 清理：移除工作区，避免污染同相位后续测试
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})

	test('home picker deletes a conversation (file + tab)', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-home-delconv', {})
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo home-delete')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('home-delete')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			const sessionsDir = join(dir, '.fount', 'code', 'sessions')
			/**
			 * 磁盘上该工作区的会话文件。
			 * @returns {string[]} 会话文件名列表。
			 */
			const sessionFiles = () => readdirSync(sessionsDir).filter(name => name.endsWith('.json'))
			await expect(async () => {
				expect(sessionFiles()).toHaveLength(1)
			}).toPass()
			await holdLocale(page)
			try {
				await page.locator('#home-toggle').click()
				await page.locator('#home-session-list .code-home-row', { hasText: '未命名会话' }).locator('.code-home-row-delete').click()
				await page.locator('dialog[open] [data-dialog-resolve="ok"]').click()
				await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(0)
				// 会话标签被关闭 → 回落为单个新草稿
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
				await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
			}
			finally {
				await releaseLocale(page)
			}
			await expect(async () => {
				expect(sessionFiles()).toHaveLength(0)
			}).toPass()
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('home picker removes a workspace but keeps its session files on disk', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-home-rmws', {})
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo keep-me')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('keep-me')
			const sessionsDir = join(dir, '.fount', 'code', 'sessions')
			/**
			 * 磁盘上该工作区的会话文件。
			 * @returns {string[]} 会话文件名列表。
			 */
			const sessionFiles = () => readdirSync(sessionsDir).filter(name => name.endsWith('.json'))
			await expect(async () => {
				expect(sessionFiles()).toHaveLength(1)
			}).toPass()
			await holdLocale(page)
			try {
				await page.locator('#home-toggle').click()
				await page.locator('#home-workspace-list .code-home-row', { hasText: basename(dir) }).first().locator('.code-home-row-delete').click()
				await page.locator('dialog[open] [data-dialog-resolve="ok"]').click()
				await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(0)
			}
			finally {
				await releaseLocale(page)
			}
			// 仅移除保存条目 → 磁盘会话文件保留
			expect(sessionFiles()).toHaveLength(1)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('folder browser lists drive roots on open and lists a directory after navigating by path', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-browse', { 'inner/note.txt': 'hi' })
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
			// 打开即列出根（本机盘符 / unix /）
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 顶部输入路径回车后列出该目录内容
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('inner')
			// 双击目录进入（仅显示文件夹：inner 内只有 note.txt，列表应显示无匹配）
			await page.locator('#folder-entries .folder-browser-entry', { hasText: 'inner' }).dblclick()
			await expect(page.locator('#folder-path-input')).toHaveValue(dir.replace(/[\\/]+$/, '') + '/inner')
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(0)
			// 选中当前目录（inner）为工作区
			await page.locator('#folder-select-button').click()
			await expect(page.locator('#workspace-pill-label')).toContainText('inner')
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('folder browser filters entries and navigates with arrow + enter', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-filter', {
			'alpha/note.txt': 'a',
			'beta/note.txt': 'b',
			'gamma/note.txt': 'c',
		})
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 导航到 <root>：alpha / beta / gamma 三个子目录
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('beta')
			// 输入过滤词 beta：列表仅剩 beta
			await page.locator('#folder-path-input').fill('beta')
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(1)
			await expect(page.locator('#folder-entries .folder-browser-entry')).toContainText('beta')
			await expect(page.locator('#folder-entries .folder-browser-entry')).not.toContainText('alpha')
			// 方向键移动高亮（单条目时停在首项）→ 回车进入目录
			await page.locator('#folder-path-input').press('ArrowDown')
			await page.locator('#folder-path-input').press('ArrowDown')
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toContainText('beta')
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-path-input')).toHaveValue(dir.replace(/[\\/]+$/, '') + '/beta')
			// 仅显示文件夹：beta 内只有 note.txt 文件，列表应为空态
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(0)
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('folder browser treats an edited path as navigation: clears selection and Enter jumps', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-nav', {
			'alpha/note.txt': 'a',
			'beta/note.txt': 'b',
		})
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 导航到 dir：alpha / beta 两个子目录
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('alpha')
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toHaveCount(1)
			// 编辑路径：改为父目录（含分隔符，目录部分偏离当前视图）→ 高亮取消
			const parent = dirname(dir)
			await page.locator('#folder-path-input').fill(parent)
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toHaveCount(0)
			// 方向键不再移动选中
			await page.locator('#folder-path-input').press('ArrowDown')
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toHaveCount(0)
			// 回车跳转到父目录（列出 dir 自身）
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-path-input')).toHaveValue(parent)
			await expect(page.locator('#folder-entries .folder-browser-entry', { hasText: basename(dir) })).toBeVisible()
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('folder browser shows quick access group for the current workspace', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-quick', {
			'current/.git/HEAD': 'ref: refs/heads/main',
			'sibling/note.txt': 'hi',
		})
		try {
			// 后端先保存工作区（boot 会把它选为当前工作区）
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'current', machine: '0', path: join(dir, 'current') } })
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
			// 根视图附带快速访问分组（兄弟目录 + 编辑器源）
			await expect(page.locator('.folder-browser-group').first()).toContainText('快速访问')
			await expect(page.locator('#folder-entries .folder-browser-entry', { hasText: 'sibling' })).toBeVisible()
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
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
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
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
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
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
			// home 总览弹窗右栏列出该会话，点击打开（已开 → 聚焦）
			await page.locator('#home-toggle').click()
			const homeSession = page.locator('#home-session-list .code-home-row', { hasText: '未命名会话' })
			await expect(homeSession).toBeVisible()
			await homeSession.locator('.code-home-row-main').click()
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
			// 右键会话标签 → 删除对话（确认后关闭标签并从磁盘移除）
			await holdLocale(page)
			try {
				await page.locator('#tab-strip .code-tab', { hasText: '未命名会话' }).click({ button: 'right' })
				await page.locator('#code-tab-menu [data-i18n="code.sessions.delete"]').click()
				await page.locator('[data-dialog-resolve="ok"]').click()
			}
			finally {
				await releaseLocale(page)
			}
			await expect(page.locator('#tab-strip .code-tab', { hasText: '未命名会话' })).toHaveCount(0)
			// 清理：移除工作区，避免污染同相位后续测试
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})

	test('tab right-click menu closes the tab and batches (left / others / all)', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-tabmenu-'))
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			// 建 4 个草稿标签
			for (let i = 0; i < 3; i++) await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(4)
			await holdLocale(page)
			try {
				const tabs = page.locator('#tab-strip .code-tab')
				// 右键第 2 个标签 → 菜单出现
				await tabs.nth(1).click({ button: 'right' })
				await expect(page.locator('#code-tab-menu')).toBeVisible()
				// 关闭左侧 → 3 个
				await page.locator('#code-tab-menu [data-i18n="code.tabs.closeMenu.left"]').click()
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(3)
				// 关闭其他（右键首个）→ 1 个
				await page.locator('#tab-strip .code-tab').first().click({ button: 'right' })
				await page.locator('#code-tab-menu [data-i18n="code.tabs.closeMenu.others"]').click()
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
				// 关闭全部 → 回落为一个新草稿（草稿图标，语言无关）
				await page.locator('#tab-strip .code-tab').first().click({ button: 'right' })
				await page.locator('#code-tab-menu [data-i18n="code.tabs.closeMenu.all"]').click()
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
				await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-avatar-draft')).toBeVisible()
			}
			finally {
				await releaseLocale(page)
			}
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
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
			// 等后端防抖落盘：轮询 /tabs 直到两个草稿标签且第二个 draft 为 'draft B'
			await expect(async () => {
				const tabsData = await (await page.request.get(`${baseUrl}${API_BASE}/tabs`)).json()
				expect(tabsData.tabs).toHaveLength(2)
				expect(tabsData.tabs[1].draft).toBe('draft B')
			}).toPass()
			await page.reload({ waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(composer).toContainText('draft B')
			// 切回第一个草稿标签，其未发送内容恢复为 A
			await page.locator('#tab-strip .code-tab').first().click()
			await expect(composer).toContainText('draft A')
			// 清理：移除工作区，避免污染同相位后续测试
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})
})

test.describe('code shell message actions & layout', () => {
	test('wide layout: messages live in a centered 70% column (char left, user right, composer same width)', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await page.setViewportSize({ width: 1600, height: 900 })
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('布局测试')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
		const messagesBox = await page.locator('#messages').boundingBox()
		const charBox = await page.locator('.code-message.role-char').boundingBox()
		const userBox = await page.locator('.code-message.role-user').boundingBox()
		const colLeft = messagesBox.x + messagesBox.width * 0.15
		const colRight = messagesBox.x + messagesBox.width * 0.85
		expect(Math.abs(charBox.x - colLeft)).toBeLessThanOrEqual(2)
		expect(Math.abs(userBox.x + userBox.width - colRight)).toBeLessThanOrEqual(2)
		// composer 卡片与消息列同宽同缘
		const shellBox = await page.locator('.code-composer-shell').boundingBox()
		expect(Math.abs(shellBox.x - colLeft)).toBeLessThanOrEqual(2)
		expect(Math.abs(shellBox.width - (colRight - colLeft))).toBeLessThanOrEqual(2)
	})

	test('overflow: long code lines scroll inside the code block, not the message flow', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-overflow', {})
		leftoverWorkspaceDirs.add(dir)
		const longLine = 'x'.repeat(300)
		const codeLines = Array.from({ length: 20 }, (_, index) => index === 0 ? longLine : `line ${index}`)
		const sessionId = 'overflow-session'
		try {
			// 保存工作区并把含超长代码块的 file-operations 工具条目直接落盘，Deep link 打开
			const workspaceData = await (await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'overflow', machine: '0', path: dir } })).json()
			const workspaceId = workspaceData.list.find(workspace => workspace.path === dir).id
			const session = {
				id: sessionId,
				title: 'overflow',
				charname: 'codeBuddy',
				profile: 'build',
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				memory: {},
				entries: [{
					id: 'tool-1',
					uid: 'system',
					role: 'tool',
					name: 'file-operations',
					content: '在 . 下搜索 xxx，命中 20 处：\n\n```text\n' + codeLines.join('\n') + '\n```\n',
					time: new Date().toISOString(),
				}],
			}
			expect((await page.request.post(`${baseUrl}${API_BASE}/sessions`, { data: { machine: '0', workdir: dir, session } })).ok()).toBeTruthy()
			await page.goto(`${baseUrl}${BASE}?workspace=${workspaceId}&session=${sessionId}`, { waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			const tool = page.locator('.code-message.role-tool')
			await expect(tool).toContainText('命中 20 处')
			// 代码块自身横向滚动（scrollWidth > clientWidth），说明超长行被收在代码块内部
			const pre = await tool.locator('pre').first().evaluate(element => ({
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
				overflowX: getComputedStyle(element).overflowX,
			}))
			expect(pre.overflowX).toBe('auto')
			expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth)
			// 整个消息流不产生横向溢出
			const flow = await page.locator('#messages').evaluate(element => ({
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
			}))
			expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('tool logs use distinct localized labels; empty char tool generations render no bubble', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-tool-labels', {})
		leftoverWorkspaceDirs.add(dir)
		const sessionId = 'tool-labels-session'
		try {
			const workspaceData = await (await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'tool-labels', machine: '0', path: dir } })).json()
			const workspaceId = workspaceData.list.find(workspace => workspace.path === dir).id
			const now = new Date().toISOString()
			const session = {
				id: sessionId,
				title: 'tool-labels',
				charname: 'codeBuddy',
				profile: 'build',
				created: now,
				updated: now,
				memory: {},
				entries: [
					// 纯工具调用生成的原始条目：人类展示层被管线清空 → 不应渲染空气泡
					{ id: 'raw-1', uid: 'char', role: 'char', name: 'codeBuddy', content: '<view-file>\nsrc/a.mjs\n</view-file>', content_for_show: '', time: now },
					{ id: 'tool-1', uid: 'system', role: 'tool', name: 'file-operations.view-file', content: '文件内容', time: now },
					{ id: 'tool-2', uid: 'system', role: 'tool', name: 'file-operations.replace-file', content: '已修改', time: now },
					{ id: 'tool-3', uid: 'system', role: 'tool', name: 'code-execution.run-pwsh', content: 'echo hi', time: now },
					// 未知第三方工具：无 i18n 映射，后备从调用卡解析触发标签名
					{ id: 'tool-4', uid: 'system', role: 'tool', name: 'timer', content: '定时器已设置', content_for_show: '```\n<set-timer duration="5s">\n```\n\n定时器已设置', time: now },
					{ id: 'answer', uid: 'char', role: 'char', name: 'codeBuddy', content: '最终回答。', time: now },
				],
			}
			expect((await page.request.post(`${baseUrl}${API_BASE}/sessions`, { data: { machine: '0', workdir: dir, session } })).ok()).toBeTruthy()
			await page.goto(`${baseUrl}${BASE}?workspace=${workspaceId}&session=${sessionId}`, { waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			await holdLocale(page)
			await expect(page.locator('.code-message.role-char')).toHaveCount(1)
			await expect(page.locator('.code-message.role-char')).toContainText('最终回答。')
			await expect(page.locator('.code-message.role-tool')).toHaveCount(4)
			const labels = await page.locator('.code-tool-log-name').allTextContents()
			expect(labels).toHaveLength(4)
			expect(new Set(labels).size).toBe(4)
			// 标签必须本地化到人类名，而非原始插件名
			for (const label of labels) expect(label).not.toContain('file-operations')
			// 未知工具用触发标签名兜底
			expect(labels).toContain('set-timer')
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('message actions: hover bar, inline edit, 👍/👎 feedback, drag export, save as HTML', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('你好')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
		// 编辑 user 消息（仅改文本，不重发）
		const userBubble = page.locator('.code-message.role-user')
		await userBubble.hover()
		await expect(userBubble.locator('.code-message-edit')).toBeVisible()
		// 保存为 HTML 只属于角色消息
		await expect(userBubble.locator('.code-message-save-html')).toHaveCount(0)
		await userBubble.locator('.code-message-edit').click()
		await page.locator('.code-message-editor textarea').fill('你好（已编辑）')
		await page.locator('.code-message-editor .btn-primary').click()
		await expect(userBubble).toContainText('你好（已编辑）')
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。')
		// 👍 切换高亮，再点取消
		const charBubble = page.locator('.code-message.role-char')
		await charBubble.locator('.code-message-feedback-up').click()
		await expect(charBubble.locator('.code-message-feedback-up')).toHaveClass(/active/)
		await charBubble.locator('.code-message-feedback-up').click()
		await expect(charBubble.locator('.code-message-feedback-up')).not.toHaveClass(/active/)
		// 👎 弹原因区（可取消）→ 提交记录
		await charBubble.locator('.code-message-feedback-down').click()
		// 原因区展开时操作栏须让位（否则会压住原因区右下角的提交/取消按钮）
		await expect(charBubble.locator('.code-message-actions')).toBeHidden()
		await page.locator('.code-message-feedback-reason textarea').fill('答非所问')
		await page.locator('.code-message-feedback-reason .btn-primary').click()
		await expect(charBubble.locator('.code-message-feedback-down')).toHaveClass(/active/)
		// 拖出导出：mousedown 非正文区置 draggable，dragstart 带原始 markdown
		const dragText = await page.evaluate(async () => {
			const bubble = document.querySelector('.code-message.role-char')
			bubble.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
			await new Promise(resolve => setTimeout(resolve, 120))
			const dt = new DataTransfer()
			bubble.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
			return dt.getData('text/plain')
		})
		expect(dragText).toContain('测试回复。')
		// 保存为 HTML：建 gist 并跳转查看页（下载/分享在查看页进行）
		await charBubble.hover()
		await charBubble.locator('.code-message-save-html').click()
		await page.waitForURL(/parts\/shells:gist\/view\/?\?id=/, { timeout: 30_000 })
		await expect(page.locator('#view-title')).toBeVisible({ timeout: 30_000 })
	})

	test('copy action copies the hovered entry own text, not a neighbour entry', async ({ page, baseUrl }) => {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('复制我自己的消息')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
		const userBubble = page.locator('.code-message.role-user')
		await userBubble.hover()
		await userBubble.locator('.code-message-copy').click()
		await expect(async () => {
			const text = await page.evaluate(() => navigator.clipboard.readText())
			expect(text).toBe('复制我自己的消息')
		}).toPass()
		// 第二轮：用户消息上方有角色消息，验证 hover 操作栏不会复制到相邻气泡
		await composer.click()
		await page.keyboard.type('第二条用户消息')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-char')).toHaveCount(2, { timeout: 60_000 })
		const secondUserBubble = page.locator('.code-message.role-user').last()
		await secondUserBubble.hover()
		await secondUserBubble.locator('.code-message-copy').click()
		await expect(async () => {
			const text = await page.evaluate(() => navigator.clipboard.readText())
			expect(text).toBe('第二条用户消息')
		}).toPass()
	})

	test('copy action works while the reply is still streaming', async ({ page, baseUrl }) => {
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('流式期间复制')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.generating')).toBeVisible({ timeout: 30_000 })
		const userBubble = page.locator('.code-message.role-user').last()
		await userBubble.hover()
		await userBubble.locator('.code-message-copy').click()
		await expect(async () => {
			const text = await page.evaluate(() => navigator.clipboard.readText())
			expect(text).toBe('流式期间复制')
		}).toPass()
	})

	test('message action bar is anchored below its own message', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('悬停归属测试')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
		const userBubble = page.locator('.code-message.role-user')
		await userBubble.hover()
		const shape = await userBubble.evaluate(bubble => {
			const box = bubble.getBoundingClientRect()
			const bar = bubble.querySelector('.code-message-actions').getBoundingClientRect()
			return { messageTop: box.top, messageBottom: box.bottom, barTop: bar.top, barBottom: bar.bottom }
		})
		// 操作栏必须落在本条消息的下缘（不得浮到消息上方，否则会看起来属于上一条消息）
		expect(shape.barTop).toBeGreaterThan(shape.messageTop)
		expect(shape.barTop).toBeLessThan(shape.messageBottom)
	})

	test('regen: refresh button on the last char message regenerates it in place', async ({ page, baseUrl }) => {
		// streamAgent 分片流式（800ms/片）：生成中气泡可被稳定断言
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('你好')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText('流式第一段。流式第二段。', { timeout: 60_000 })
		await expect(page.locator('.code-message-feedback-regen')).toBeVisible()
		await page.locator('.code-message-feedback-regen').click()
		// 弹出旧回复 → 生成中气泡 → done 追加新回复
		await expect(page.locator('.code-message.generating')).toBeVisible()
		await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText('流式第一段。流式第二段。', { timeout: 60_000 })
		await expect(page.locator('.code-message.generating')).toHaveCount(0)
		await expect(page.locator('.code-message.role-user')).toHaveCount(1)
		await expect(page.locator('.code-message.role-char:not(.generating)')).toHaveCount(1)
	})

	test('edit & feedback persist into the workspace session file', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-actions-'))
		try {
			await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('你好')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
			const userBubble = page.locator('.code-message.role-user')
			await userBubble.hover()
			await userBubble.locator('.code-message-edit').click()
			await page.locator('.code-message-editor textarea').fill('你好（已编辑）')
			await page.locator('.code-message-editor .btn-primary').click()
			await page.locator('.code-message.role-char .code-message-feedback-up').click()
			// 非生成时 markSessionDirty 立即落盘；轮询读回工作区会话文件
			await expect(async () => {
				const tabsData = await (await page.request.get(`${baseUrl}${API_BASE}/tabs`)).json()
				const active = tabsData.tabs.find(tab => tab.type === 'session')
				expect(active).toBeTruthy()
				const res = await page.request.get(`${baseUrl}${API_BASE}/sessions/${active.id}?machine=0&workdir=${encodeURIComponent(dir)}`)
				const session = await res.json()
				expect(session.entries.find(entry => entry.role === 'user')?.content).toBe('你好（已编辑）')
				expect(session.entries.find(entry => entry.role === 'char')?.extension?.feedback?.type).toBe('up')
			}).toPass()
		}
		finally {
			// 先 API 移除工作区让后端释放会话句柄（否则 Windows 上 rm 会持续 EBUSY）；
			// 页面关闭后的 flush 因工作区已删不会重建，rmDirRetry 此时即可删净
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('attachments: + button and paste add pending files, sent as user entry files', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-attach-'))
		try {
			const filePath = join(dir, 'note.txt')
			writeFileSync(filePath, 'attachment content')
			const chooserPromise = page.waitForEvent('filechooser')
			await page.locator('#attach-button').click()
			const chooser = await chooserPromise
			await chooser.setFiles(filePath)
			await expect(page.locator('.code-attachment-chip')).toContainText('note.txt')
			// 粘贴图片入列
			await page.evaluate(() => {
				const file = new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' })
				const dt = new DataTransfer()
				dt.items.add(file)
				document.getElementById('composer-input').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
			})
			await expect(page.locator('.code-attachment-chip')).toHaveCount(2)
			// 发送 → 用户条目带 files（气泡 chip 由服务端条目渲染），发送后预览清空
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('看附件')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
			await expect(page.locator('.code-message.role-user')).toContainText('📎 note.txt')
			await expect(page.locator('.code-message.role-user')).toContainText('📎 pic.png')
			await expect(page.locator('.code-attachment-chip')).toHaveCount(0)
		}
		finally {
			await rmDirRetry(dir)
		}
	})
})

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
			await expect(userBubble).toContainText(`📎 ${gistTitle}.md`)
		}
		finally {
			await page.request.post(`${baseUrl}/api/parts/shells:gist/gists/batch-delete`, { data: { ids: [gistId] } })
		}
	})
})

test.describe('code shell power actions', () => {
	test('settings dialog configures per-host power action', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await holdLocale(page)
		try {
			const button = page.locator('#power-settings-button')
			await expect(button).toHaveText('完成后自动操作设置')
			await button.click()
			const dialog = page.locator('dialog.modal', { has: page.locator('#power-settings-list') })
			await expect(dialog).toBeVisible()
			// 无 subfount 时仅有本机可选，四个操作项（不操作/关机/休眠/重启）
			await expect(dialog.locator('select[data-machine-id]')).toHaveCount(1)
			const select = dialog.locator('select[data-machine-id="0"]')
			await expect(select).toBeVisible()
			await expect(select.locator('option')).toHaveCount(4)
			// 选择关机 → 按钮显示已武装
			await select.selectOption('shutdown')
			await expect(button).toHaveText('任务完成后：1 台主机')
			await expect(async () => {
				const data = await (await page.request.get(`${baseUrl}${API_BASE}/shutdown`)).json()
				expect(data.actions).toEqual({ 0: 'shutdown' })
			}).toPass()
			// 改为休眠
			await select.selectOption('sleep')
			await expect(async () => {
				const data = await (await page.request.get(`${baseUrl}${API_BASE}/shutdown`)).json()
				expect(data.actions).toEqual({ 0: 'sleep' })
			}).toPass()
			// 恢复不操作 → 按钮回到默认
			await select.selectOption('')
			await expect(button).toHaveText('完成后自动操作设置')
			await expect(async () => {
				const data = await (await page.request.get(`${baseUrl}${API_BASE}/shutdown`)).json()
				expect(data.actions).toEqual({})
			}).toPass()
		}
		finally {
			await releaseLocale(page)
		}
	})
})

test.describe('code shell composer keyboard handling', () => {
	test('slash command panel lists workspace commands right after boot into a saved workspace', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-slash', { '.agents/commands/test-cmd.md': '---\ndescription: 测试命令\n---\n渲染内容' })
		try {
			// 先保存工作区：boot 会把它选为当前工作区，草稿标签落在其上（不触发工作区切换）
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'slash', machine: '0', path: dir } })
			await openCode(page, baseUrl)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('/test')
			const panel = page.locator('.code-slash-panel')
			await expect(panel).toBeVisible()
			await expect(panel.locator('.code-slash-item')).toHaveCount(1)
			await expect(panel).toContainText('test-cmd')
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('one Enter press after typing a sentence inserts exactly one newline', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('hello world')
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('hello world\n')
		// 再按一次回车 → 两个换行（第二次不该吞掉）
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('hello world\n\n')
	})
})

test.describe('code shell home picker search', () => {
	test('home picker filters workspaces and sessions by search term', async ({ page, baseUrl }) => {
		const alphaDir = makeWorkspace('fe-search-alpha', {})
		const betaDir = makeWorkspace('fe-search-beta', {})
		leftoverWorkspaceDirs.add(alphaDir)
		leftoverWorkspaceDirs.add(betaDir)
		try {
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'alpha', machine: '0', path: alphaDir } })
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'beta', machine: '0', path: betaDir } })
			const now = new Date().toISOString()
			await page.request.post(`${baseUrl}${API_BASE}/sessions`, { data: { machine: '0', workdir: alphaDir, session: { id: 'alpha-session', title: 'alpha 会话', charname: 'codeBuddy', profile: 'build', created: now, updated: now, memory: {}, entries: [] } } })
			await openCode(page, baseUrl)
			await page.locator('#home-toggle').click()
			const search = page.locator('#home-search')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(2)
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(1)
			// 搜索工作区名 beta → 左栏仅剩匹配项，右栏自动切到该工作区（无会话 → 空态）
			await search.fill('beta')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(1)
			await expect(page.locator('#home-workspace-list')).toContainText('beta')
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(0)
			// 搜索工作区名 alpha → 右栏列出其会话
			await search.fill('alpha')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(1)
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(1)
			await expect(page.locator('#home-session-list')).toContainText('alpha 会话')
			// 清空搜索 → 全部恢复
			await search.fill('')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(2)
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(1)
			await page.keyboard.press('Escape')
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(alphaDir)
			await rmDirRetry(betaDir)
		}
	})
})

test.describe('code shell workspace pill search & usage order', () => {
	test('workspace dropdown sorts by recent usage and filters by search', async ({ page, baseUrl }) => {
		const alphaDir = makeWorkspace('fe-use-alpha', {})
		const betaDir = makeWorkspace('fe-use-beta', {})
		const gammaDir = makeWorkspace('fe-use-gamma', {})
		leftoverWorkspaceDirs.add(alphaDir)
		leftoverWorkspaceDirs.add(betaDir)
		leftoverWorkspaceDirs.add(gammaDir)
		try {
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'alpha', machine: '0', path: alphaDir } })
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'beta', machine: '0', path: betaDir } })
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'gamma', machine: '0', path: gammaDir } })
			// 按使用时间标记：gamma 最近、beta 次之、alpha 最久（间隔拉开毫秒级保证顺序稳定）
			for (const name of ['alpha', 'beta', 'gamma']) {
				const { list } = await (await page.request.get(`${baseUrl}${API_BASE}/workspaces`)).json()
				const id = list.find(workspace => workspace.name === name).id
				await page.request.put(`${baseUrl}${API_BASE}/workspaces/${id}/use`)
				await new Promise(resolve => setTimeout(resolve, 40))
			}
			await openCode(page, baseUrl)
			await holdLocale(page)
			try {
				await page.locator('#workspace-pill').click()
				const items = page.locator('#workspace-menu .menu-item', { hasText: /alpha|beta|gamma/ })
				await expect(items).toHaveCount(3)
				// 常用程度排序：gamma（最近）→ beta → alpha
				const order = await items.allTextContents()
				expect(order[0]).toContain('gamma')
				expect(order[1]).toContain('beta')
				expect(order[2]).toContain('alpha')
				// 搜索过滤：仅剩 beta
				await page.locator('#workspace-menu input').fill('beta')
				await expect(page.locator('#workspace-menu .menu-item', { hasText: /alpha|beta|gamma/ })).toHaveCount(1)
				await expect(page.locator('#workspace-menu .menu-item', { hasText: 'beta' })).toBeVisible()
			}
			finally {
				await releaseLocale(page)
			}
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(alphaDir)
			await rmDirRetry(betaDir)
			await rmDirRetry(gammaDir)
		}
	})
})

test.describe('code shell notification suppression', () => {
	test('notification marks an inactive session tab, activating clears it, and ?session= restores the session', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-notify-'))
		leftoverWorkspaceDirs.add(dir)
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('通知抑制测试')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
			// 会话标签地址栏带 session 参数
			await expect(async () => {
				expect(new URL(page.url()).searchParams.get('session')).toBeTruthy()
			}).toPass()
			const sessionId = new URL(page.url()).searchParams.get('session')
			/**
			 * 模拟 Service Worker 通知事件。
			 * @param {string} id session id
			 * @returns {Promise<void>} 事件派发完成
			 */
			const dispatchNotification = id => page.evaluate(session => {
				window.dispatchEvent(new CustomEvent('fount-notification', {
					detail: { title: 'x', options: { tag: `code:${session}` }, targetUrl: `/parts/shells:code/?session=${session}`, suppressed: true },
				}))
			}, id)
			// 当前活动标签即通知来源：不显示角标
			await dispatchNotification(sessionId)
			await expect(page.locator('.code-tab-unread')).toHaveCount(0)
			// 新建草稿标签 → 会话标签转为非活动，且地址栏不再带 session
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(async () => {
				expect(new URL(page.url()).searchParams.get('session')).toBeNull()
			}).toPass()
			// 非活动会话收到被抑制的通知 → 出现未读红点
			await dispatchNotification(sessionId)
			await expect(page.locator('.code-tab-unread')).toHaveCount(1)
			// 点击该会话标签：角标清除，地址栏切回该会话
			await page.locator('#tab-strip .code-tab', { has: page.locator('.code-tab-unread') }).click()
			await expect(page.locator('.code-tab-unread')).toHaveCount(0)
			await expect(async () => {
				expect(new URL(page.url()).searchParams.get('session')).toBe(sessionId)
			}).toPass()
			// 通知点击深链：关闭会话标签后以 ?session= 重开，应从磁盘恢复会话（而非仅命中已开标签）
			const workspaceId = new URL(page.url()).searchParams.get('workspace')
			await page.locator('#tab-strip .code-tab:not(:has(.code-tab-avatar-draft)) .code-tab-close').click()
			await expect(page.locator('#tab-strip .code-tab:not(:has(.code-tab-avatar-draft))')).toHaveCount(0)
			await page.goto(`${baseUrl}${BASE}?workspace=${workspaceId}&session=${sessionId}`, { waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"]')).toHaveCount(1)
			await expect(page.locator('.code-message.role-user')).toContainText('通知抑制测试')
			await expect(page.locator('.code-tab-unread')).toHaveCount(0)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})
})
