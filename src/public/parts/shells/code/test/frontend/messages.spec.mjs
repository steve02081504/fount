/**
 * code shell 前端 UI 测试：消息气泡布局、工具日志、消息操作（编辑 / 反馈 / 导出）、附件。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { API_BASE, BASE, holdLocale, leftoverWorkspaceDirs, makeWorkspace, openCode, PREF_PREFIX, removeAllWorkspacesViaApi, rmDirRetry, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

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

	test('agentic rounds append as messages while the reply is still streaming', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-incremental', { 'note.txt': 'note content' })
		leftoverWorkspaceDirs.add(dir)
		try {
			await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'multiRoundAgent'), PREF_PREFIX)
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('开始多轮任务')
			await page.keyboard.press('Control+Enter')
			// 生成期间轮询 DOM：记录是否在任何一刻「生成中气泡与已完成条目并存」
			const observed = await page.evaluate(async () => {
				const state = { toolWhileGenerating: false, charWhileGenerating: false }
				const deadline = Date.now() + 30_000
				while (Date.now() < deadline) {
					if (!document.querySelector('.code-message.generating')) break
					if (document.querySelectorAll('.code-message.role-tool').length) state.toolWhileGenerating = true
					if (document.querySelectorAll('.code-message.role-char:not(.generating)').length) state.charWhileGenerating = true
					await new Promise(resolve => setTimeout(resolve, 20))
				}
				return state
			})
			// 流式期间已完成的工具条目与角色条目必须先追加出来，而不是等 done 后一次性刷出
			expect(observed.toolWhileGenerating).toBe(true)
			expect(observed.charWhileGenerating).toBe(true)
			// 结束后仍是同一批条目，无重复
			await expect(page.locator('.code-message.generating')).toHaveCount(0)
			await expect(page.locator('.code-message.role-tool')).toHaveCount(1)
			await expect(page.locator('.code-message.role-char')).toHaveCount(2)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('generation survives a page reload: backend persists and the reloaded page recovers', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-reload-recover', {})
		leftoverWorkspaceDirs.add(dir)
		try {
			await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('重载恢复')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.generating')).toBeVisible({ timeout: 30_000 })
			// 生成中整页重载：前端状态清空，但后端继续生成并把权威结果落盘
			await page.reload({ waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			// 恢复轮询取回磁盘上的最终回复，不再整轮丢失
			await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText('流式第一段。流式第二段。', { timeout: 90_000 })
			await expect(page.locator('.code-message.generating')).toHaveCount(0)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
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
			await expect(page.locator('.code-message.role-user')).toContainText('note.txt')
			await expect(page.locator('.code-message.role-user')).toContainText('pic.png')
			await expect(page.locator('.code-message.role-user .code-message-file-chip')).toHaveCount(2)
			await expect(page.locator('.code-message.role-user .code-message-file-chip .text-icon')).toHaveCount(2)
			await expect(page.locator('.code-attachment-chip')).toHaveCount(0)
		}
		finally {
			await rmDirRetry(dir)
		}
	})
})
