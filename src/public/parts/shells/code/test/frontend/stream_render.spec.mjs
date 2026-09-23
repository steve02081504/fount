/** 真实会话 WS → 逐帧预览 → 浏览器 Markdown → 最终会话条目的渲染回归。 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, BASE, leftoverWorkspaceDirs, makeWorkspace, openCode, PREF_PREFIX, removeAllWorkspacesViaApi, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test('orphan-fence repair leaves intentional and closed code fences intact', async ({ modulePage }) => {
	const outputs = await modulePage.run(async () => {
		const { repairOrphanedReplyFence } = await import('/parts/shells:code/src/replyMarkdown.mjs')
		return [
			'开头\n```\n\n**实测通过的**\n1. 工具',
			'开头\n```text\n\n**实测通过的**\n1. 工具',
			'开头\n```\n\n**实测通过的**\n1. 工具\n```',
			'开头\n```\n正文没有报告列表',
		].map(repairOrphanedReplyFence)
	})
	expect(outputs).toEqual([
		'开头\n\n**实测通过的**\n1. 工具',
		'开头\n```text\n\n**实测通过的**\n1. 工具',
		'开头\n```\n\n**实测通过的**\n1. 工具\n```',
		'开头\n```\n正文没有报告列表',
	])
})

test('actual multi-round stream appends a repaired report before the final answer', async ({ page, baseUrl }) => {
	const dir = makeWorkspace('fe-report-stream', { 'note.txt': 'note content' })
	leftoverWorkspaceDirs.add(dir)
	try {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'multiRoundAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		await selectWorkspaceViaBrowser(page, dir)
		await page.locator('#composer-input').click()
		await page.keyboard.type('多轮渲染测试')
		await page.keyboard.press('Control+Enter')
		const first = page.locator('.code-message.role-char:not(.generating)').first()
		await expect(first.locator('strong')).toContainText(['实测通过的', '发现的欠缺 / 可改进'], { timeout: 60_000 })
		await expect(first.locator('.markdown-code-block')).toHaveCount(0)
		await expect(page.locator('.code-message.role-tool')).toHaveCount(1)
		await expect(page.locator('.code-message.role-char:not(.generating)')).toHaveCount(2, { timeout: 60_000 })
		await expect(page.locator('.code-message.role-char:not(.generating)').last()).toContainText('读取完成，这是最终回答。')
		await expect(page.locator('.code-message.generating')).toHaveCount(0)
		const entries = await page.locator('.code-message[data-entry-id]').evaluateAll(nodes => nodes.map(node => ({ role: node.className.match(/role-(\w+)/)?.[1], text: node.textContent })))
		expect(entries.map(entry => entry.role)).toEqual(['user', 'char', 'tool', 'char'])
		expect(entries[1].text).toContain('实测通过的')
	}
	finally {
		await removeAllWorkspacesViaApi(page, baseUrl)
	}
})

test('completed run-js does not remain below later streaming text', async ({ page, baseUrl }) => {
	await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'toolAgent'), PREF_PREFIX)
	await openCode(page, baseUrl)
	await page.locator('#composer-input').click()
	await page.keyboard.type('工具后继续生成')
	await page.keyboard.press('Control+Enter')
	await expect(page.locator('.code-message.generating .code-tool-live')).toBeVisible({ timeout: 60_000 })
	await expect.poll(() => page.locator('#messages').evaluate(flow => ({
		preview: flow.querySelector('.code-message.generating .code-message-body')?.textContent.includes('工具已经执行完') || false,
		live: flow.querySelectorAll('.code-message.generating .code-tool-live').length,
	})), { timeout: 60_000 }).toEqual({ preview: true, live: 0 })
	await expect(page.locator('.code-message.generating')).toHaveCount(0)
	await expect(page.locator('.code-message.role-tool')).toContainText('live-tool-output')
})

test('persisted multi-round transcript renders the report outside its orphan fence', async ({ page, baseUrl }) => {
	// 取自真实会话 9df34984.json 的条目形态：第一轮原文含孤立的裸围栏，
	// 后续有两个 async-task.list 工具条目与另一轮带 reasoning 的回复。
	const dir = makeWorkspace('fe-report-roundtrip')
	leftoverWorkspaceDirs.add(dir)
	const report = '\n<grep> 结果：\n未找到匹配。\n```\n\nSo those strings don\'t exist in the repo.\n\n**实测通过的**\n1. 文件工具链: glob、grep、view-file。\n2. 子代理: 异步启动→list-async→inspect-async。\n\n**发现的欠缺 / 可改进**\n\n需要我针对上面某一条直接动手改吗？'
	try {
		const data = await (await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'report', machine: '0', path: dir } })).json()
		const workspaceId = data.list.find(workspace => workspace.path === dir).id
		const now = new Date().toISOString()
		const session = {
			id: 'real-report-regression', title: '报告渲染', charname: 'streamAgent', profile: 'build',
			created: now, updated: now, memory: {},
			entries: [
				{ id: 'user', role: 'user', uid: 'user', name: 'user', content: '试试你的subagent、文件读写等agent功能', time: now },
				{ id: 'report', role: 'char', uid: 'char', name: 'ZL-31', content: report, content_for_show: report, time: now },
				...['tool-1', 'tool-2'].map(id => ({ id, role: 'tool', uid: 'system', name: 'async-task.list', content: '当前没有进行中的异步任务。', extension: { asyncList: { kind: null, tasks: [] } }, time: now })),
				{
					id: 'followup', role: 'char', uid: 'char', name: 'ZL-31', content: '结论一句话：**文件读写层扎实**。',
					content_for_show: '<details><summary>推理过程</summary><p>已核对。</p></details>\n\n结论一句话：**文件读写层扎实**。', time: now,
				},
			],
		}
		expect((await page.request.post(`${baseUrl}${API_BASE}/sessions`, { data: { machine: '0', workdir: dir, session } })).ok()).toBeTruthy()
		await page.goto(`${baseUrl}${BASE}?workspace=${workspaceId}&session=${session.id}`, { waitUntil: 'domcontentloaded' })
		await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
		const first = page.locator('.code-message[data-entry-id="report"]')
		await expect(page.locator('.code-message.role-char:not(.generating)')).toHaveCount(2)
		await expect(page.locator('.code-message.role-tool')).toHaveCount(2)
		await expect(first.locator('strong')).toContainText(['实测通过的', '发现的欠缺 / 可改进'])
		await expect(first.locator('li')).toHaveCount(2)
		await expect(first.locator('.markdown-code-block')).toHaveCount(0)
		await expect(first).toContainText('需要我针对上面某一条直接动手改吗？')
		await expect(page.locator('.code-message[data-entry-id="followup"] details summary')).toHaveText('推理过程')
		// 仅修正呈现，不改变给角色的原始消息和保存层。
		const saved = await (await page.request.get(`${baseUrl}${API_BASE}/sessions/${session.id}?machine=0&workdir=${encodeURIComponent(dir)}`)).json()
		expect(saved.entries.find(entry => entry.id === 'report').content).toBe(report)
		expect(saved.entries.find(entry => entry.id === 'report').content_for_show).toBe(report)
		await page.reload({ waitUntil: 'domcontentloaded' })
		await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
		await expect(first.locator('strong')).toContainText(['实测通过的', '发现的欠缺 / 可改进'])
		await expect(page.locator('.code-message.role-char:not(.generating)')).toHaveCount(2)
	}
	finally {
		await removeAllWorkspacesViaApi(page, baseUrl)
	}
})

for (const width of [1600, 390])
	test(`streaming long report keeps code contained and restores markdown at ${width}px`, async ({ page, baseUrl }) => {
		const frames = []
		page.on('websocket', socket => {
			if (!socket.url().includes('/ws/parts/shells:code/session')) return
			socket.on('framereceived', ({ payload }) => {
				try { frames.push(JSON.parse(String(payload))) }
				catch { /* 仅收集 JSON 会话帧 */ }
			})
		})
		await page.setViewportSize({ width, height: 900 })
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		await openCode(page, baseUrl)
		await page.locator('#composer-input').click()
		await page.keyboard.type('渲染边界测试')
		await page.keyboard.press('Control+Enter')

		const generating = page.locator('.code-message.generating')
		await expect(generating.locator('.markdown-code-block pre')).toContainText('LONG-LINE-', { timeout: 60_000 })
		// 此时服务端只发了开围栏与 119 行代码，尚未发结束围栏及报告尾部。
		expect(frames.some(frame => frame.type === 'preview' && frame.content.includes('LONG-LINE-') && !frame.content.includes('修复计划'))).toBe(true)
		const during = await page.locator('#messages').evaluate(flow => {
			const pre = flow.querySelector('.code-message.generating .markdown-code-block pre')
			return {
				flowWidth: flow.clientWidth,
				flowScrollWidth: flow.scrollWidth,
				preWidth: pre.clientWidth,
				preScrollWidth: pre.scrollWidth,
				preHeight: pre.clientHeight,
				preScrollHeight: pre.scrollHeight,
				viewportHeight: window.innerHeight,
			}
		})
		expect(during.preScrollWidth).toBeGreaterThan(during.preWidth)
		expect(during.flowScrollWidth).toBeLessThanOrEqual(during.flowWidth + 1)
		expect(during.preHeight).toBeLessThanOrEqual(during.viewportHeight * 0.6)
		expect(during.preScrollHeight).toBeGreaterThan(during.preHeight)

		const answer = page.locator('.code-message.role-char:not(.generating)')
		await expect(answer.locator('h2')).toHaveText('修复计划', { timeout: 60_000 })
		await expect(answer.locator('li')).toHaveText(['第一项', '第二项'])
		await expect(answer.locator('.markdown-code-block pre')).toContainText('LONG-LINE-')
		await expect(answer.locator('.markdown-code-block pre')).not.toContainText('修复计划')
		await expect(generating).toHaveCount(0)
		await expect.poll(() => frames.some(frame => frame.type === 'done')).toBe(true)
		const previews = frames.filter(frame => frame.type === 'preview')
		const done = frames.find(frame => frame.type === 'done')
		expect(previews.length).toBeGreaterThanOrEqual(4)
		expect(previews.at(-1).content).toBe(done.entries.find(entry => entry.role === 'char').content)
		const final = await page.locator('#messages').evaluate(flow => ({ scrollWidth: flow.scrollWidth, clientWidth: flow.clientWidth }))
		expect(final.scrollWidth).toBeLessThanOrEqual(final.clientWidth + 1)
	})
