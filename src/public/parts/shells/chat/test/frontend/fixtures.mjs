import { request as playwrightRequest } from '@playwright/test'

import { createFountFixtures } from '../../../../../../../.github/workflows/test_lib/playwright_fixtures.mjs'

/** 隔离节点专用测试用户名（与 run.mjs 中 launchNode.username 一致） */
export const TEST_USERNAME = process.env.FOUNT_TEST_USERNAME || 'chat-fe-user'

const HUB_INIT_TIMEOUT = 180_000

export const { test, expect } = createFountFixtures({ locale: 'zh-CN' })

test.beforeEach(async ({ baseUrl, apiKey }) => {
	test.setTimeout(240_000)
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
 * 等待 Hub 壳层可见（不依赖 init 完整结束）。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
export async function waitForHubShell(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
	await expect(page.locator('#hub-add-server-button')).toBeVisible()
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
 * 通过 API 创建测试群组。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {string} [opts.description]
 * @param {string} [opts.defaultChannelName]
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>}
 */
export async function createTestGroup(baseUrl, apiKey, opts = {}) {
	const name = opts.name ?? `pw-group-${Date.now()}`
	const body = {
		name,
		description: opts.description ?? 'playwright frontend test',
		...(opts.defaultChannelName ? { defaultChannelName: opts.defaultChannelName } : {}),
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
 * 通过 hash 深链进入群频道并等待 composer 可用。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} groupId
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function openGroupChannel(page, baseUrl, groupId, channelId) {
	const encodedGroup = encodeURIComponent(groupId)
	await page.goto(
		`${baseUrl}/parts/shells:chat/hub/#group:${encodedGroup}:${channelId}`,
		{ waitUntil: 'domcontentloaded' },
	)
	await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
	await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: HUB_INIT_TIMEOUT })
	await expect(page.locator('#hub-send-button')).toBeEnabled()
}

/**
 * 打开 Hub 并进入新建测试群默认频道。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {object} [groupOpts] createTestGroup 选项
 * @returns {Promise<{ groupId: string, channelId: string }>}
 */
export async function openFreshGroupChannel(page, baseUrl, apiKey, groupOpts = {}) {
	const { groupId, defaultChannelId } = await createTestGroup(baseUrl, apiKey, groupOpts)
	await openGroupChannel(page, baseUrl, groupId, defaultChannelId)
	return { groupId, channelId: defaultChannelId }
}

/**
 * 通过 composer 发送消息并等待 API 成功。
 * @param {import('@playwright/test').Page} page
 * @param {string} groupId
 * @param {string} channelId
 * @param {string} text 正文
 * @returns {Promise<object>} 发消息 API 响应 JSON
 */
export async function sendMessageViaComposer(page, groupId, channelId, text) {
	await page.locator('#hub-message-input').fill(text)
	const encodedGroup = encodeURIComponent(groupId)
	const encodedChannel = encodeURIComponent(channelId)
	const [postResponse] = await Promise.all([
		page.waitForResponse(res =>
			res.url().includes(`/groups/${encodedGroup}/channels/${encodedChannel}/messages`)
			&& res.request().method() === 'POST'
			&& res.status() === 200,
			{ timeout: HUB_INIT_TIMEOUT },
		),
		page.locator('#hub-send-button').click(),
	])
	const postJson = await postResponse.json()
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
