import { request as playwrightRequest } from '@playwright/test'

import { createFountFixtures } from '../../../../../../../.github/workflows/test_lib/playwright_fixtures.mjs'

const HUB_INIT_TIMEOUT = 180_000

/** Hub 导航 cache-bust 序号（避免同一 URL 命中 bfcache）。 */
let hubNavSeq = 0

/** 隔离节点专用测试用户名（与 run.mjs 中 launchNode.username 一致） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME || 'chat-fe-user'

/** Playwright 等待 Hub 就绪的默认超时（毫秒） */
export const HUB_INIT_TIMEOUT_MS = HUB_INIT_TIMEOUT

/**
 *
 */
export const { test, expect } = createFountFixtures({ locale: 'zh-CN' })

test.beforeEach(async ({ page, baseUrl, apiKey }) => {
	test.setTimeout(300_000)
	page.on('pageerror', err => console.log('[browser:pageerror]', err.message, err.stack))
	page.on('requestfailed', req => console.log('[browser:requestfailed]', req.url(), req.failure()?.errorText))
	page.on('response', res => { if (res.status() >= 400) console.log('[browser:http]', res.status(), res.url()) })
	await page.route('https://esm.sh/**', async route => {
		const url = route.request().url()
		if (url.includes('@sentry/browser')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/javascript',
				body: [
					'export default {',
					'  captureException() {},',
					'  init() {},',
					'  browserTracingIntegration() { return {} },',
					'};',
					'export function captureException() {}',
					'export function init() {}',
					'export function browserTracingIntegration() { return {} }',
				].join('\n'),
			})
			return
		}
		await route.continue()
	})
	if (process.env.FOUNT_TEST_ISOLATED !== '1')
		throw new Error(
			'Chat 前端测试须通过 test/frontend/run.mjs 启动（自启隔离节点），'
			+ '勿对本地开发实例或真实用户数据运行。',
		)
	const req = await playwrightRequest.newContext()
	try {
		const whoami = await req.get(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		if (!whoami.ok())
			throw new Error(`whoami failed: ${whoami.status()}`)
		const data = await whoami.json()
		if (data.username !== TEST_USERNAME)
			throw new Error(
				`测试须使用隔离用户 "${TEST_USERNAME}"，当前为 "${data.username}"。`
				+ '请通过 run.mjs 启动，勿指向生产/开发 fount。',
			)
	}
	finally {
		await req.dispose()
	}
})

/**
 * 等待 Hub 壳层可见并完成 initCore 导航。
 *
 * `waitUntil: 'domcontentloaded'` 已保证入口模块（index.mjs）同步执行完毕，
 * `wireBootstrap()` 的建群/成员侧栏点击监听随之挂载。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {{ waitUntil?: 'domcontentloaded' | 'load', friendsMode?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function waitForHubShell(page, baseUrl, opts = {}) {
	const waitUntil = opts.waitUntil ?? 'domcontentloaded'
	const friendsMode = opts.friendsMode !== false
	hubNavSeq += 1
	await page.goto(`${baseUrl}/parts/shells:chat/hub/?_hub=${hubNavSeq}`, {
		waitUntil,
		timeout: HUB_INIT_TIMEOUT,
	})
	await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
	await expect(page.locator('#hub-add-server-button')).toBeVisible()
	await waitForHubCoreReady(page)
	if (friendsMode && !page.url().includes('#group:'))
		await expect(page.locator('#hub-message-input')).toBeDisabled({ timeout: 90_000 })
}

/**
 * 打开 Chat Hub 并等待侧栏就绪。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
export async function openChatHub(page, baseUrl) {
	await waitForHubShell(page, baseUrl)
	await expect(page.locator('#hub-message-input')).toBeVisible()
}

/**
 * 从当前 URL hash 解析群与频道 ID。
 * @param {string} url
 * @returns {{ groupId: string, channelId: string } | null}
 */
export function parseGroupHashFromUrl(url) {
	const hash = new URL(url).hash.slice(1)
	if (!hash.startsWith('group:')) return null
	const rest = hash.slice('group:'.length)
	const sep = rest.indexOf(':')
	if (sep < 0) return null
	try {
		const groupId = decodeURIComponent(rest.slice(0, sep))
		const channelId = rest.slice(sep + 1)
		if (!groupId || !channelId) return null
		return { groupId, channelId }
	}
	catch {
		return null
	}
}

/**
 * 通过 Hub UI 创建群组并进入默认频道。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {string} [opts.description]
 * @param {boolean} [opts.waitForComposer=true]
 * @returns {Promise<{ groupId: string, channelId: string }>}
 */
export async function createGroupViaHubUi(page, baseUrl, opts = {}) {
	const name = opts.name ?? `pw-ui-${Date.now()}`
	if (!page.url().includes('/parts/shells:chat/hub/'))
		await waitForHubShell(page, baseUrl)
	else {
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('#hub-add-server-button')).toBeVisible()
	}
	await page.locator('#hub-add-server-button').click()
	const createCard = page.locator('.server-action-picker-card[data-action="create"]')
	await expect(createCard).toBeVisible({ timeout: 30_000 })
	await createCard.click()
	await expect(page.locator('#create-group-form')).toBeVisible({ timeout: 30_000 })
	await page.locator('#create-group-form input[name="name"]').fill(name)
	if (opts.description)
		await page.locator('#create-group-form textarea[name="description"]').fill(opts.description)
	await Promise.all([
		page.waitForURL(/#group:/, { timeout: HUB_INIT_TIMEOUT }),
		page.locator('#create-group-form button[type="submit"]').click(),
	])
	const parsed = parseGroupHashFromUrl(page.url())
	if (!parsed) throw new Error(`group hash missing after create: ${page.url()}`)
	if (opts.waitForComposer !== false)
		await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: HUB_INIT_TIMEOUT })
	return parsed
}

/**
 * 通过 API 创建测试群组。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {object} [opts]
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>}
 */
export async function createTestGroup(baseUrl, apiKey, opts = {}) {
	const name = opts.name ?? `pw-group-${Date.now()}`
	const body = {
		name,
		description: opts.description ?? 'playwright frontend test',
		...opts.defaultChannelName ? { defaultChannelName: opts.defaultChannelName } : {},
	}
	const req = await playwrightRequest.newContext()
	try {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:chat/groups/?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: body },
		)
		if (!res.ok()) throw new Error(`createGroup failed: ${res.status()}`)
		const data = await res.json()
		if (!data.groupId) throw new Error('groupId missing')
		return {
			groupId: data.groupId,
			defaultChannelId: data.defaultChannelId || 'default',
		}
	}
	finally {
		await req.dispose()
	}
}

/**
 * 等待 initCore 完成 hash 导航。
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function waitForHubCoreReady(page) {
	await page.waitForFunction(async () => {
		const { getHubCoreState, whenHubCoreReady } = await import('/parts/shells:chat/hub/core/hubReady.mjs')
		const state = getHubCoreState()
		if (state === 'error') throw new Error('Hub initCore failed')
		if (state === 'ready') return true
		await whenHubCoreReady()
		return true
	}, { timeout: 90_000 })
}

/**
 * @param {string} baseUrl
 * @param {string} hash 不含 `#`
 * @returns {string}
 */
function hubUrlWithHash(baseUrl, hash) {
	hubNavSeq += 1
	return `${baseUrl}/parts/shells:chat/hub/?_hub=${hubNavSeq}#${hash}`
}

/**
 * 等待指定群频道 composer 可用（含侧栏点击回退）。
 * @param {import('@playwright/test').Page} page
 * @param {string} groupId
 * @returns {Promise<void>}
 */
async function waitForGroupComposerReady(page, groupId) {
	const input = page.locator('#hub-message-input')
	for (let attempt = 0; attempt < 2; attempt++) 
		try {
			await expect(input).toBeEnabled({ timeout: 30_000 })
			return
		}
		catch {
			if (attempt === 0) {
				const serverItem = page.locator(`#hub-server-list .hub-server-item[data-group-id="${groupId}"]`)
				if (await serverItem.isVisible().catch(() => false)) {
					await serverItem.click()
					continue
				}
				await page.reload({ waitUntil: 'domcontentloaded' })
			}
		}
	
	const serverItem = page.locator(`#hub-server-list .hub-server-item[data-group-id="${groupId}"]`)
	await expect(serverItem).toBeVisible({ timeout: 60_000 })
	await serverItem.click()
	await expect(input).toBeEnabled({ timeout: 60_000 })
}

/**
 * 导航到指定群频道并等待 composer 可用。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} groupId
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function openGroupChannel(page, baseUrl, groupId, channelId) {
	const encodedGroup = encodeURIComponent(groupId)
	await page.goto(
		hubUrlWithHash(baseUrl, `group:${encodedGroup}:${channelId}`),
		{ waitUntil: 'domcontentloaded', timeout: HUB_INIT_TIMEOUT },
	)
	await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
	await waitForHubCoreReady(page)
	await waitForGroupComposerReady(page, groupId)
}

/** @type {Promise<{ groupId: string, defaultChannelId: string }> | null} */
let sharedTestGroupPromise = null

/**
 * 全套件复用的测试群（避免每用例 API 建群拖垮隔离节点）。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>}
 */
export async function ensureSharedTestGroup(baseUrl, apiKey) {
	if (!sharedTestGroupPromise)
		sharedTestGroupPromise = createTestGroup(baseUrl, apiKey, { name: `pw-shared-${Date.now()}` })
	return sharedTestGroupPromise
}

/**
 * 在同页内通过 hash 进入群频道（避免 friends→group 全页 reload 的 bfcache / init 竞态）。
 * @param {import('@playwright/test').Page} page
 * @param {string} groupId
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function navigateGroupChannelHash(page, groupId, channelId) {
	await page.evaluate(
		({ gid, cid }) => { location.hash = `group:${encodeURIComponent(gid)}:${cid}` },
		{ gid: groupId, cid: channelId },
	)
	await expect(page).toHaveURL(new RegExp(`#group:${encodeURIComponent(groupId)}`))
	await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: 60_000 })
}

/**
 * 匹配频道发消息 POST 响应。
 * @param {import('@playwright/test').Response} res
 * @param {string} groupId
 * @param {string} channelId
 * @returns {boolean}
 */
export function isChannelMessagePost(res, groupId, channelId) {
	if (res.request().method() !== 'POST' || res.status() !== 200) return false
	let pathname
	try {
		pathname = new URL(res.url()).pathname
	}
	catch {
		return false
	}
	const groupSeg = encodeURIComponent(groupId)
	const channelSeg = encodeURIComponent(channelId)
	return pathname.includes(`/groups/${groupSeg}/channels/${channelSeg}/messages`)
		|| pathname.endsWith(`/groups/${groupSeg}/channels/${channelSeg}/messages`)
}

/**
 * 打开 Hub 并进入测试群默认频道（默认复用套件级共享群；`groupOpts.fresh: true` 强制新建）。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {object} [groupOpts] createTestGroup 选项；`fresh: true` 时每次新建群
 * @returns {Promise<{ groupId: string, channelId: string }>}
 */
export async function openFreshGroupChannel(page, baseUrl, apiKey, groupOpts = {}) {
	const { groupId, defaultChannelId } = groupOpts.fresh === true
		? await createTestGroup(baseUrl, apiKey, groupOpts)
		: await ensureSharedTestGroup(baseUrl, apiKey)
	const hashFrag = `group:${encodeURIComponent(groupId)}:${defaultChannelId}`
	if (page.url().includes('/parts/shells:chat/hub/')) {
		if (page.url().includes(`#${hashFrag}`)) {
			const input = page.locator('#hub-message-input')
			try {
				await expect(input).toBeEnabled({ timeout: 15_000 })
				return { groupId, channelId: defaultChannelId }
			}
			catch { /* fall through to hash nav */ }
		}
		await navigateGroupChannelHash(page, groupId, defaultChannelId)
		return { groupId, channelId: defaultChannelId }
	}
	await openGroupChannel(page, baseUrl, groupId, defaultChannelId)
	return { groupId, channelId: defaultChannelId }
}

/** POST 响应等待上限（毫秒）；超时后改以 UI 消息行确认。 */
const MESSAGE_POST_TIMEOUT = 20_000

/**
 * 通过 composer 发送消息并等待 API 成功。
 * @param {import('@playwright/test').Page} page
 * @param {string} groupId
 * @param {string} channelId
 * @param {string} text 正文
 * @returns {Promise<object>} 发消息 API 响应 JSON
 */
export async function sendMessageViaComposer(page, groupId, channelId, text) {
	const postPromise = page.waitForResponse(
		res => isChannelMessagePost(res, groupId, channelId),
		{ timeout: MESSAGE_POST_TIMEOUT },
	)
	await page.locator('#hub-message-input').fill(text)
	await page.locator('#hub-send-button').click()
	let postJson
	try {
		postJson = await (await postPromise).json()
	}
	catch {
		await expectMessageInChat(page, text)
		throw new Error(`channel message POST timed out after ${MESSAGE_POST_TIMEOUT}ms (message visible in UI)`)
	}
	await expect(page.locator('#hub-message-input')).toHaveValue('')
	return postJson
}

/**
 * 等待消息列表中出现包含指定文本的消息行。
 * @param {import('@playwright/test').Page} page
 * @param {string} text 消息正文片段
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function expectMessageInChat(page, text) {
	const row = page.locator('#hub-messages .hub-message').filter({ hasText: text })
	await expect(row.first()).toBeVisible({ timeout: 60_000 })
	return row.first()
}

/**
 * 读取消息 POST 响应中的正文。
 * @param {object} postJson API 响应
 * @returns {string | undefined}
 */
export function messageTextFromPostResponse(postJson) {
	const content = postJson.event?.content ?? postJson.content
	if (typeof content === 'string') return content
	return content?.content
}
