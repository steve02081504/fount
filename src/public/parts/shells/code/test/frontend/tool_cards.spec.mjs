/**
 * code shell 前端 UI 测试：代码高亮、sub-agent 检查卡与异步任务卡。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, BASE, leftoverWorkspaceDirs, makeWorkspace, removeAllWorkspacesViaApi, rmDirRetry, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test.describe('code shell tool cards & highlighting', () => {
	test('renders highlighted code, ansi output, async inspect and task cards', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-tool-cards', {})
		leftoverWorkspaceDirs.add(dir)
		const sessionId = 'tool-cards-session'
		try {
			const workspaceData = await (await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'tool-cards', machine: '0', path: dir } })).json()
			const workspaceId = workspaceData.list.find(workspace => workspace.path === dir).id
			const now = new Date().toISOString()
			const session = {
				id: sessionId,
				title: 'tool-cards',
				charname: 'codeBuddy',
				profile: 'build',
				created: now,
				updated: now,
				memory: {},
				entries: [
					// 含 js 围栏：验证语法高亮 token 被着色
					{
						id: 'js-1', uid: 'system', role: 'tool', name: 'code-execution.run-js',
						content: '执行结果：\n2',
						content_for_show: '```js\nconst answer = 40 + 2\n```\n\n执行结果：\n2',
						time: now,
					},
					// shell 执行结果：展示层为 ansi 代码块（保留终端颜色）
					{
						id: 'shell-1', uid: 'system', role: 'tool', name: 'code-execution.run-pwsh',
						content: '退出码 0，耗时 1ms：\nhello',
						content_for_show: '```pwsh\necho hi\n```\n\n退出码 0，耗时 1ms：\n\n```ansi\n\u001b[31mhello\u001b[0m\r\nworld\r\nthird\n```',
						time: now,
					},
					// `<inspect-async/>` 统一的运行中检视卡（子代理载荷带 entries）
					{
						id: 'inspect-1', uid: 'system', role: 'tool', name: 'async-task.inspect',
						content: '异步任务 run-1（类型：subagent，状态：running）\n\n最新进展：\n[char] Char: hi',
						time: now,
						extension: {
							asyncInspect: {
								id: 'run-1', kind: 'subagent', state: 'running', label: '检查',
								rounds: 1, roundLimit: 3,
								entries: [
									{ role: 'system', name: 'system', content: '任务：检查' },
									{ role: 'tool', name: 'code-execution.run-js', content: '```js\nconsole.log(1)\n```' },
								],
							},
						},
					},
					// 后台异步任务派发卡
					{
						id: 'async-1', uid: 'system', role: 'tool', name: 'code-execution.async',
						content: 'JS 已在后台运行', time: now,
						extension: { asyncTask: { id: 'task-1', kind: 'js', label: 'const x = 1' } },
					},
					// <list-async/> 结构化任务列表
					{
						id: 'list-1', uid: 'system', role: 'tool', name: 'async-task.list',
						content: '进行中的异步任务（1）：\n- [js] task-1', time: now,
						extension: { asyncList: { kind: null, tasks: [{ id: 'task-1', kind: 'js', label: 'const x = 1', startedAt: Date.now() }] } },
					},
				],
			}
			expect((await page.request.post(`${baseUrl}${API_BASE}/sessions`, { data: { machine: '0', workdir: dir, session } })).ok()).toBeTruthy()
			await page.goto(`${baseUrl}${BASE}?workspace=${workspaceId}&session=${sessionId}`, { waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')

			// 语法高亮：color-scheme 属性存在，且 shiki token 计算色与正文不同（此前属性缺失 → 全单色）
			await expect(page.locator('.code-message.role-tool pre code span[style*="--shiki"]').first()).toBeVisible()
			const highlight = await page.evaluate(() => {
				const span = document.querySelector('.code-message.role-tool pre code span[style*="--shiki"]')
				return {
					attr: document.documentElement.getAttribute('color-scheme'),
					color: getComputedStyle(span).color,
					base: getComputedStyle(document.querySelector('.code-message.role-tool')).color,
				}
			})
			expect(highlight.attr).toMatch(/^only (light|dark)$/)
			expect(highlight.color).not.toBe(highlight.base)

			// shell 结果：ansi 代码块渲染出终端颜色，且不影响条数
			await expect(page.locator('.code-message.role-tool pre.markdown-ansi-block')).toHaveCount(1)
			await expect(page.locator('pre.markdown-ansi-block')).toContainText('hello')
			const ansiColor = await page.evaluate(() => {
				const span = document.querySelector('pre.markdown-ansi-block span[style*="color"]')
				return span ? getComputedStyle(span).color : ''
			})
			expect(ansiColor).not.toBe('')

			// 单次换行只占一行：ansi2html 老版把换行写成 `<br/>\n` 且不归一化 CRLF，容器保留空白就会把 3 行渲染成 6+ 行
			const ansiLines = await page.evaluate(() => {
				const pre = document.querySelector('pre.markdown-ansi-block')
				const cs = getComputedStyle(pre)
				const inner = pre.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
				return Math.round(inner / parseFloat(cs.lineHeight))
			})
			expect(ansiLines).toBe(3)

			// inspect-async：统一的运行中检视卡（复用子代理对话渲染）
			await expect(page.locator('.code-async-inspect .code-transcript-entry')).toHaveCount(2)

			// 异步任务派发卡 + <list-async/> 任务行
			await expect(page.locator('.code-async-card[data-async-task-id="task-1"]')).toHaveCount(1)
			await expect(page.locator('.code-async-card .code-run-card-label')).toContainText('const x = 1')
			await expect(page.locator('.code-async-task-row')).toHaveCount(1)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})
})
