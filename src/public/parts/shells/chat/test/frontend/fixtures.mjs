import { request as playwrightRequest } from '@playwright/test'
import { createFountFixtures } from 'fount/scripts/test/playwright_fixtures.mjs'
import { assertIsolatedFrontendTest, stubSentryOnPage } from 'fount/scripts/test/playwright_guards.mjs'
import { waitForHubCoreReady } from 'fount/scripts/test/playwright_ready.mjs'

const HUB_INIT_TIMEOUT = 180_000

/** 隔离节点专用测试用户名（由 run.mjs 注入 FOUNT_TEST_USERNAME） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME

/**
 *
 */
export const { test: baseTest, expect } = createFountFixtures({ locale: 'zh-CN' })

baseTest.beforeEach(async ({ page, baseUrl, apiKey }) => {
	if (!TEST_USERNAME)
		throw new Error('FOUNT_TEST_USERNAME is required; run via test/frontend/run.mjs')
	page.on('pageerror', err => console.log('[browser:pageerror]', err.message, err.stack))
	page.on('requestfailed', req => console.log('[browser:requestfailed]', req.url(), req.failure()?.errorText))
	page.on('response', res => { if (res.status() >= 400) console.log('[browser:http]', res.status(), res.url()) })
	await stubSentryOnPage(page)
	await assertIsolatedFrontendTest({
		baseUrl,
		apiKey,
		expectedUsername: TEST_USERNAME,
		shellLabel: 'Chat',
	})
})

/**
 * 等待 Hub 壳层可见并完成 initCore 导航。
 *
 * `waitUntil: 'domcontentloaded'` 已保证入口模块（index.mjs）同步执行完毕，
 * `wireBootstrap()` 的建群/成员侧栏点击监听随之挂载。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @param {{ waitUntil?: 'domcontentloaded' | 'load', friendsMode?: boolean }} [opts] - 导航选项。
 * @returns {Promise<void>} 无返回值。
 */
export async function waitForHubShell(page, baseUrl, opts = {}) {
	const waitUntil = opts.waitUntil ?? 'domcontentloaded'
	const friendsMode = opts.friendsMode !== false
	await page.goto(`${baseUrl}/parts/shells:chat/hub/`, {
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
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @returns {Promise<void>} 无返回值。
 */
export async function openChatHub(page, baseUrl) {
	await waitForHubShell(page, baseUrl)
	await expect(page.locator('#hub-message-input')).toBeVisible()
}

/**
 * 从当前 URL hash 解析群与频道 ID。
 * @param {string} url - 当前页面 URL。
 * @returns {{ groupId: string, channelId: string } | null} 解析结果或 null。
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
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @param {object} [opts] - 可选项。
 * @param {string} [opts.name] - 群名称。
 * @param {string} [opts.description] - 群描述。
 * @param {boolean} [opts.waitForComposer=true] - 是否等待 composer 可用。
 * @returns {Promise<{ groupId: string, channelId: string }>} 群与默认频道 ID。
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
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {object} [opts] - 可选项。
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} 新建群信息。
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
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} hash - 不含 `#` 的 hash 片段。
 * @returns {string} 完整 Hub URL。
 */
function hubUrlWithHash(baseUrl, hash) {
	return `${baseUrl}/parts/shells:chat/hub/#${hash}`
}

/**
 * 等待指定群频道 composer 可用（含侧栏点击回退）。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} groupId - 群 ID。
 * @returns {Promise<void>} 无返回值。
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
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} groupId - 群 ID。
 * @param {string} channelId - 频道 ID。
 * @returns {Promise<void>} 无返回值。
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

/**
 * 在同页内通过 hash 进入群频道（避免全页 reload 时 initCore 与 hashchange 竞态）。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} groupId - 群 ID。
 * @param {string} channelId - 频道 ID。
 * @returns {Promise<void>} 无返回值。
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
 * @param {import('npm:@playwright/test').Response} response - HTTP 响应。
 * @param {string} groupId - 群 ID。
 * @param {string} channelId - 频道 ID。
 * @returns {boolean} 是否为频道发消息 POST。
 */
export function isChannelMessagePost(response, groupId, channelId) {
	if (response.request().method() !== 'POST' || response.status() < 200 || response.status() >= 300) return false
	const pathname = new URL(response.url()).pathname
	const groupSegment = encodeURIComponent(groupId)
	const channelSegment = encodeURIComponent(channelId)
	return pathname.includes(`/groups/${groupSegment}/channels/${channelSegment}/messages`)
}

/**
 * 打开 Hub 并进入测试群默认频道（每用例新建群）。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {object} [groupOpts] - createTestGroup 选项。
 * @returns {Promise<{ groupId: string, channelId: string }>} 群与频道 ID。
 */
export async function openFreshGroupChannel(page, baseUrl, apiKey, groupOpts = {}) {
	const { groupId, defaultChannelId } = await createTestGroup(baseUrl, apiKey, groupOpts)
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
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} groupId - 群 ID。
 * @param {string} channelId - 频道 ID。
 * @param {string} text - 消息正文。
 * @returns {Promise<object>} 发消息 API 响应 JSON。
 */
export async function sendMessageViaComposer(page, groupId, channelId, text) {
	const postPromise = page.waitForResponse(
		res => isChannelMessagePost(res, groupId, channelId),
		{ timeout: MESSAGE_POST_TIMEOUT },
	)
	await page.locator('#hub-message-input').fill(text)
	await page.locator('#hub-send-button').click()
	const postJson = await (await postPromise).json()
	await expect(page.locator('#hub-message-input')).toHaveValue('')
	return postJson
}

/**
 * 等待消息列表中出现包含指定文本的消息行。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} text - 消息正文片段。
 * @returns {Promise<import('npm:@playwright/test').Locator>} 消息行定位器。
 */
export async function expectMessageInChat(page, text) {
	const row = page.locator('#hub-messages .hub-message').filter({ hasText: text })
	await expect(row.first()).toBeVisible({ timeout: 60_000 })
	return row.first()
}

/**
 * 读取消息 POST 响应中的正文。
 * @param {object} postJson - API 响应。
 * @returns {string | undefined} 消息正文。
 */
export function messageTextFromPostResponse(postJson) {
	const content = postJson.event?.content ?? postJson.content
	return content?.text || content?.content || content || ''
}

/**
 * 通过 API 在群内创建文本频道。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} apiKey - API 密钥。
 * @param {string} groupId - 群 ID。
 * @param {object} [opts] - 可选项。
 * @returns {Promise<{ channelId: string, name: string }>} 新建频道信息。
 */
export async function createTestChannel(baseUrl, apiKey, groupId, opts = {}) {
	const name = opts.name ?? `pw-ch-${Date.now()}`
	const req = await playwrightRequest.newContext()
	try {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { name, type: opts.type ?? 'text' } },
		)
		if (!res.ok()) throw new Error(`createChannel failed: ${res.status()}`)
		const data = await res.json()
		if (!data.channelId) throw new Error('channelId missing')
		return { channelId: data.channelId, name }
	}
	finally {
		await req.dispose()
	}
}

/**
 * 定位包含指定正文的消息行。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} text - 消息正文片段。
 * @returns {import('npm:@playwright/test').Locator} 消息行定位器。
 */
export function messageRowByText(page, text) {
	return page.locator('#hub-messages .hub-message').filter({ hasText: text }).first()
}

/**
 * 打开群设置页（`#settings:<groupId>` hash）。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} baseUrl - 测试根 URL。
 * @param {string} groupId - 群 ID。
 * @returns {Promise<void>} 无返回值。
 */
export async function openGroupSettingsPage(page, baseUrl, groupId) {
	await page.goto(
		`${baseUrl}/parts/shells:chat/settings/#settings:${encodeURIComponent(groupId)}`,
		{ waitUntil: 'domcontentloaded', timeout: HUB_INIT_TIMEOUT },
	)
	await expect(page.locator('#group-settings-container')).toBeVisible({ timeout: 60_000 })
}
/**
 * 通过 emoji-picker 浮层选取 Unicode 表情（避免穿透 shadow DOM）。
 * @param {import('npm:@playwright/test').Page} page - Playwright 页面。
 * @param {string} [emoji='👍'] - 要选中的 emoji。
 * @returns {Promise<void>} 无返回值。
 */
export async function pickEmojiFromPicker(page, emoji = '👍') {
	await expect(page.locator('#emoji-picker-popup emoji-picker')).toBeVisible({ timeout: 30_000 })
	await page.locator('#emoji-picker-popup emoji-picker').evaluate((el, unicode) => {
		el.dispatchEvent(new CustomEvent('emoji-click', { detail: { unicode } }))
	}, emoji)
	await expect(page.locator('#emoji-picker-popup')).toHaveCount(0, { timeout: 10_000 })
}

/**
 * 扩展 groupChannel：打开 Hub 并进入新建测试群默认频道。
 */
export const test = baseTest.extend({
	/**
	 * @param {(channel: { groupId: string, channelId: string }) => Promise<void>} use - Playwright fixture use 回调。
	 */
	groupChannel: async ({ page, baseUrl, apiKey }, use) => {
		await use(await openFreshGroupChannel(page, baseUrl, apiKey))
	},
})
