/**
 * code shell 前端 UI 测试：composer 边缘提示 / 目标选择器的对话态收起。
 */
import { basename } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { makeWorkspace, openCode, removeAllWorkspacesViaApi, rmDirRetry, selectWorkspaceViaBrowser } from './helpers.mjs'

test.describe('code shell composer chrome', () => {
	test('collapses hint/targets once a conversation starts, keeping power + context accessible', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-chrome', {})
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const main = page.locator('.code-main')
			// 空态：选择器可见，顶栏上下文 chip 隐藏（避免与 targets 重复）
			await expect(main).toHaveClass(/empty-mode/)
			await expect(page.locator('#composer-targets')).toBeVisible()
			await expect(page.locator('#composer-hint')).toBeVisible()
			await expect(page.locator('#code-context')).toBeHidden()
			// 发一条 shell 命令进入对话（不依赖 AI 生成）
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo chrome-test')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('chrome-test')
			await expect(main).not.toHaveClass(/empty-mode/)
			// 对话态：hint / targets 收起，电源与上下文 chip 仍可达
			await expect(page.locator('#composer-targets')).toBeHidden()
			await expect(page.locator('#composer-hint')).toBeHidden()
			await expect(page.locator('#power-settings-button')).toBeVisible()
			await expect(page.locator('#code-context')).toBeVisible()
			await expect(page.locator('#code-context-workspace-label')).toContainText(basename(dir))
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})
})
