/**
 * code shell 前端测试：按标签页附件队列（选择/粘贴/拖拽入列、逐标签隔离、图片缩略图/编辑/预览、
 * 移除、超限拒绝、发送清除、仅附件发送）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { holdLocale, openCode, PREF_PREFIX, releaseLocale, rmDirRetry } from './helpers.mjs'

/**
 * 预置角色偏好（about:blank / 沙箱 frame 读 localStorage 会抛 SecurityError，同框架 fixture 处理）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>} 完成。
 */
function initCharname(page) {
	return page.addInitScript(prefix => {
		try {
			localStorage.setItem(prefix + 'charname', 'codeBuddy')
		}
		catch (error) {
			if (error.name !== 'SecurityError') throw error
		}
	}, PREF_PREFIX)
}

/**
 * 等待 boot 完成活动标签页创建（openCode 在 composer 聚焦即返回，此时 boot 尚未落到 activeTabKey）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>} 完成。
 */
async function waitForActiveTab(page) {
	await page.waitForFunction(async () => {
		const { store } = await import('/parts/shells:code/src/store.mjs')
		return Boolean(store.activeTabKey)
	})
}

/**
 * 在页面内粘贴一个文件到 composer。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {{name: string, type: string, text?: string, bytes?: number}} spec - 文件描述。
 * @returns {Promise<void>} 完成。
 */
function pasteFile(page, spec) {
	return page.evaluate(file => {
		const body = file.bytes ? new Uint8Array(file.bytes) : file.text || ''
		const blob = new File([body], file.name, { type: file.type })
		const transfer = new DataTransfer()
		transfer.items.add(blob)
		document.getElementById('composer-input').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
	}, spec)
}

/**
 * 在页面内生成并粘贴一张纯色 PNG。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} [name='pic.png'] - 文件名。
 * @returns {Promise<void>} 完成。
 */
async function pastePng(page, name = 'pic.png') {
	await page.evaluate(async fileName => {
		const canvas = document.createElement('canvas')
		canvas.width = 8
		canvas.height = 8
		const context = canvas.getContext('2d')
		context.fillStyle = '#ff3355'
		context.fillRect(0, 0, 8, 8)
		const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
		const transfer = new DataTransfer()
		transfer.items.add(new File([blob], fileName, { type: 'image/png' }))
		document.getElementById('composer-input').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
	}, name)
}

test.describe('code shell attachments', () => {
	test('picker/paste add cards, remove works, oversize is rejected', async ({ page, baseUrl }) => {
		await initCharname(page)
		await openCode(page, baseUrl)
		await waitForActiveTab(page)
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-att-'))
		try {
			const filePath = join(dir, 'note.txt')
			writeFileSync(filePath, 'attachment content')
			const chooserPromise = page.waitForEvent('filechooser')
			await page.locator('#attach-button').click()
			const chooser = await chooserPromise
			await chooser.setFiles(filePath)
			await expect(page.locator('.code-attachment-card')).toHaveCount(1)
			await expect(page.locator('.code-attachment-card')).toContainText('note.txt')
			// 粘贴普通文件
			await pasteFile(page, { name: 'paste.txt', type: 'text/plain', text: 'pasted' })
			await expect(page.locator('.code-attachment-card')).toHaveCount(2)
			// 移除指定附件（按稳定 id，不受列表下标影响）
			await page.locator('.code-attachment-card', { hasText: 'note.txt' }).locator('.code-attachment-remove').click()
			await expect(page.locator('.code-attachment-card')).toHaveCount(1)
			await expect(page.locator('.code-attachment-card')).not.toContainText('note.txt')
			// 超大文件被拒绝：只提示，不入列
			await pasteFile(page, { name: 'big.bin', type: 'application/octet-stream', bytes: 11 * 1024 * 1024 })
			await expect(page.locator('.code-attachment-card')).toHaveCount(1)
			await expect(page.locator('.alert-error')).toContainText('big.bin', { timeout: 5_000 })
		}
		finally {
			await rmDirRetry(dir)
		}
	})

	test('attachments are isolated per tab', async ({ page, baseUrl }) => {
		await initCharname(page)
		await openCode(page, baseUrl)
		await waitForActiveTab(page)
		await holdLocale(page)
		try {
			await pasteFile(page, { name: 'tab1.txt', type: 'text/plain', text: 'one' })
			await expect(page.locator('.code-attachment-card')).toHaveCount(1)
			// 新标签页：队列为空
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(page.locator('.code-attachment-card')).toHaveCount(0)
			await expect(page.locator('#attachment-preview')).toBeHidden()
			// 切回 tab1：附件仍在
			await page.locator('#tab-strip .code-tab').first().click()
			await expect(page.locator('.code-attachment-card')).toHaveCount(1)
			await expect(page.locator('.code-attachment-card')).toContainText('tab1.txt')
		}
		finally {
			await releaseLocale(page)
		}
	})

	test('image attachment shows a thumbnail, opens the editor and the viewer', async ({ page, baseUrl }) => {
		await initCharname(page)
		await openCode(page, baseUrl)
		await waitForActiveTab(page)
		await holdLocale(page)
		await pastePng(page)
		const imageCard = page.locator('.code-attachment-card-image')
		const thumbImage = imageCard.locator('.code-attachment-thumb img')
		await expect(imageCard).toHaveCount(1)
		await expect(thumbImage).toHaveAttribute('src', /^blob:/)
		const beforeSrc = await thumbImage.getAttribute('src')
		// 编辑：打开图片编辑器，应用后原位替换同一附件并刷新缩略图
		await imageCard.locator('.code-attachment-edit').dispatchEvent('click')
		await expect(page.locator('.image-editor-modal')).toBeVisible()
		await page.locator('.image-editor-modal [data-apply]').click()
		await expect(page.locator('.image-editor-modal')).toHaveCount(0)
		await expect(imageCard).toHaveCount(1)
		await expect(thumbImage).toHaveAttribute('src', /^blob:/)
		const afterSrc = await thumbImage.getAttribute('src')
		expect(afterSrc).not.toBe(beforeSrc)
		// 预览：缩略图点开全屏查看器，ESC 关闭
		await imageCard.locator('.code-attachment-thumb').click()
		await expect(page.locator('.media-viewer')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.locator('.media-viewer')).toHaveCount(0)
	})

	test('files-only send renders a user entry with the file and clears only the sent queue', async ({ page, baseUrl }) => {
		await initCharname(page)
		await openCode(page, baseUrl)
		await waitForActiveTab(page)
		await holdLocale(page)
		await pasteFile(page, { name: 'only.txt', type: 'text/plain', text: 'files only' })
		await expect(page.locator('.code-attachment-card')).toHaveCount(1)
		// 无文本，仅附件发送
		await page.locator('#send-button').click()
		await expect(page.locator('.code-message.role-user .code-message-file-chip')).toContainText('only.txt', { timeout: 60_000 })
		await expect(page.locator('.code-attachment-card')).toHaveCount(0)
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
		// 发送后新增的附件保留（清除只作用于已发送的那批）
		await pasteFile(page, { name: 'later.txt', type: 'text/plain', text: 'later' })
		await expect(page.locator('.code-attachment-card')).toHaveCount(1)
		await expect(page.locator('.code-attachment-card')).toContainText('later.txt')
	})
})
