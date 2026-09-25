/**
 * code shell 前端 UI 测试：composer 占位符、shell 模式（! 移除 / 历史 / 影子补全）、消息发送与流式渲染。
 */
import { test, expect } from './fixtures.mjs'
import { holdLocale, openCode, PREF_PREFIX, releaseLocale } from './helpers.mjs'

test.describe('code shell composer & placeholders', () => {
	test('composer placeholder stays on normal message text after blur and refocus', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderNormal')
		// 点外部可聚焦元素（发送按钮）再点回输入框：占位符不应被旧 i18n 文案（输入命令，Enter 执行…）覆盖
		await page.locator('#send-button').click()
		await expect(composer).not.toBeFocused()
		await composer.click()
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderNormal')
	})

	test('shell mode swaps the placeholder, removes ！, and Backspace on empty exits', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderNormal')
		await composer.click()
		await page.keyboard.type('！')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		// shell pill 顶格：淡出的其他选择器不再把 shell pill 挤到中间
		const controlsBox = await page.locator('.code-composer-controls-main').boundingBox()
		const shellBox = await page.locator('#shell-pill-wrap').boundingBox()
		expect(shellBox.x - controlsBox.x).toBeLessThan(8)
		// 叹号被移除，输入框为空 → shell 占位符显示
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderShell')
		// 输入内容后再删到空：不退出 shell 模式
		await page.keyboard.type('echo hi')
		await expect(placeholder).toHaveCount(0)
		await page.keyboard.press('Control+A')
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderShell')
		// 空内容再按 Backspace：退出 shell 模式
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeHidden()
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderNormal')
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

	test('! shell command streams output progressively before completion', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		// sleep 在 pwsh/powershell（Start-Sleep 别名）与 bash 下均可用
		await page.keyboard.type('！echo first-live; sleep 1; echo second-live')
		await page.locator('#send-button').click()
		// 命令未结束时输出节点已含第一段（流式回显）
		await expect(page.locator('.code-shell-stream-output')).toContainText('first-live', { timeout: 60_000 })
		// 完成后转正式工具日志并含第二段
		await expect(page.locator('.code-message.role-tool')).toContainText('second-live', { timeout: 60_000 })
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
		await expect(placeholder).toHaveAttribute('data-i18n', 'code.composer.placeholderShell')
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

	test('AI tool output streams into the generating bubble before completion', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'toolAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('运行工具')
		await page.keyboard.press('Control+Enter')
		// run-js 分段输出（约 2s）：生成中气泡内应出现实时工具卡并逐块回显
		await expect(page.locator('.code-message.generating .code-tool-live')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('.code-tool-live .code-shell-stream-output')).toContainText('live-tool-output', { timeout: 60_000 })
		// 完成后转为正式工具日志
		await expect(page.locator('.code-message.role-tool')).toContainText('live-tool-output', { timeout: 60_000 })
		await expect(page.locator('.code-message.generating')).toHaveCount(0)
	})
})
