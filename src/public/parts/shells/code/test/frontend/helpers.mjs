/**
 * code shell 前端 Playwright 共用 helper：打开页面、临时工作区、locale 轮换挂起、工作区选择与清理。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { expect } from './fixtures.mjs'

/** code shell 页面路径前缀。 */
export const BASE = '/parts/shells:code/'
/** code shell 后端 API 前缀。 */
export const API_BASE = '/api/parts/shells:code'
/** 隔离测试用户名（run.mjs testUsername）对应的 localStorage 偏好前缀。 */
export const PREF_PREFIX = 'code.shell.code-fe-user.'

/**
 * 打开 code shell 页面并等待 composer 挂载及 boot 完成。
 * 先清空后端标签页，避免跨测试残留（标签/草稿现存储在后端 shell data）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @returns {Promise<void>}
 */
export async function openCode(page, baseUrl) {
	const tabsReset = await page.request.put(`${baseUrl}${API_BASE}/tabs`, { data: { tabs: [], activeTab: '' } })
	if (!tabsReset.ok()) throw new Error(`failed to reset code tabs: ${tabsReset.status()} ${tabsReset.statusText()}`)
	await page.goto(`${baseUrl}${BASE}`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
	// composer 可编辑只表示 DOM 已挂载；测试桥只在全部启动步骤完成后置位。
	await page.waitForFunction(() => globalThis.fount?.test?.pageState?.ready === true)
}

/**
 * 在临时目录创建含指定文件的工作区。
 * @param {string} name - 工作区名。
 * @param {Record<string, string>} files - 相对路径 → 内容。
 * @returns {string} 目录路径。
 */
export function makeWorkspace(name, files = {}) {
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
export async function rmDirRetry(dir, attempts = 20) {
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
export const leftoverWorkspaceDirs = new Set()

/**
 * 注册 afterAll：在所有测试与 fixture teardown（页面关闭触发 beforeunload flush）之后清理遗留工作区目录。
 * @param {{ afterAll: (hook: () => Promise<void>) => void }} test - Playwright test 对象。
 * @returns {void}
 */
export function useLeftoverWorkspaceCleanup(test) {
	test.afterAll(async () => {
		for (const dir of leftoverWorkspaceDirs)
			await rmDirRetry(dir)
		leftoverWorkspaceDirs.clear()
	})
}

/**
 * 挂起 page watch 的 locale 轮换（每秒整页重建与下拉点击竞态，flake 源）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
export async function holdLocale(page) {
	// watch 桥由 base.mjs 动态 import 异步安装：早于它就绪时 hold 会静默失效，随后 release 计数变负
	await page.waitForFunction(() => globalThis.fount?.test?.watch?.holdLocale)
	await page.evaluate(() => globalThis.fount.test.watch.holdLocale())
}

/**
 * 恢复 locale 轮换。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
export async function releaseLocale(page) {
	// 页面/context 已关闭时（测试超时清理）不再 evaluate，避免清理错误覆盖原始失败信息
	if (page.isClosed()) return
	try {
		await page.evaluate(() => globalThis.fount?.test?.watch?.releaseLocale?.())
	}
	catch (error) {
		if (/closed|Target page, context or browser/i.test(String(error?.message || error))) return
		throw error
	}
}

/**
 * 经文件夹浏览器选定目录为工作区。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} dir - 目录路径。
 * @returns {Promise<void>}
 */
export async function selectWorkspaceViaBrowser(page, dir) {
	await openFolderBrowserViaMenu(page)
	await page.locator('#folder-path-input').fill(dir)
	await page.locator('#folder-select-button').click()
	await expect(page.locator('#workspace-pill-label')).toContainText(basename(dir))
}

/**
 * 从工作区 pill 下拉打开文件夹浏览器，并等待对话框出现后才恢复 locale 轮换。
 * page watch 的 locale 轮换每秒重建整页，与「点 pill → 点浏览菜单项 → 组件异步取模板开框」竞态
 * （重建会卸下刚点的注册 / 关闭刚开的框 → 浏览器永不出现 → 超时）；沿用 `selectWorkspaceViaBrowser`
 * 的做法挂起轮换，并在框真正可见后才 release，避免组件异步开框期间又被重建抢掉。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
export async function openFolderBrowserViaMenu(page) {
	await holdLocale(page)
	try {
		await page.locator('#workspace-pill').click()
		// 先断言菜单可见再点条目：菜单未展开时立刻报出“菜单未展开”，而非让后续点击盲等超时
		await expect(page.locator('#workspace-menu')).toBeVisible()
		await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
		await expect(page.locator('dialog.modal:has(#folder-entries)')).toBeVisible()
	}
	finally {
		await releaseLocale(page)
	}
}

/**
 * 经 API 移除全部已保存工作区（UI 移除依赖下拉点击，历史上与整页重建/布局抖动竞态 flaky；清理走确定性 API）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @returns {Promise<void>}
 */
export async function removeAllWorkspacesViaApi(page, baseUrl) {
	const { list } = await (await page.request.get(`${baseUrl}${API_BASE}/workspaces`)).json()
	for (const workspace of list || []) {
		const deleteResponse = await page.request.delete(`${baseUrl}${API_BASE}/workspaces/${workspace.id}`)
		if (!deleteResponse.ok()) throw new Error(`failed to remove workspace ${workspace.id}: ${deleteResponse.status()} ${deleteResponse.statusText()}`)
	}
}
