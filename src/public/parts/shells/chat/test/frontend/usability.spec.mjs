import { test, expect, openFreshGroupChannel, waitForHub, sendMessageViaComposer, expectMessageInChat } from './fixtures.mjs'

test('group messages and composer open while the member sidebar is pending', async ({ page, baseUrl, apiKey }) => {
	const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
	await waitForHub(page, baseUrl)
	let release
	const gate = new Promise(resolve => { release = resolve })
	const memberRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/personal-lists'))
	await page.route(url => new URL(url).pathname.endsWith('/personal-lists'), async route => {
		await gate
		await route.continue()
	})
	try {
		await page.locator(`#server-list [data-group-id="${groupId}"]`).first().click()
		await memberRequest
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false)
		await expect(page.locator('#messages .hub-empty-loading')).toHaveCount(0)
		await expect(page.locator('#member-list .member-item')).toHaveCount(0)
	}
	finally { release() }
	await expect(page.locator('#member-list .member-item').first()).toBeAttached()
})

test('a delayed member render cannot overwrite another group sidebar', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { renderMemberList } = await import('/parts/shells:chat/hub/sidebar/members.mjs')
		const { store, setState } = await import('/parts/shells:chat/hub/core/state.mjs')
		document.body.innerHTML = '<div id="member-list">new group</div><div id="member-digest"></div>'
		setState('context.currentGroupId', 'old-group')
		store.context.currentState = { members: [] }
		const originalFetch = globalThis.fetch
		let release, started
		const gate = new Promise(resolve => { release = resolve })
		const loading = new Promise(resolve => { started = resolve })
		/** @returns {Promise<Response>} 延迟旧群的成员过滤请求。 */
		globalThis.fetch = async () => { started(); await gate; return Response.json({ entries: [] }) }
		try {
			const render = renderMemberList({ members: [] })
			await loading
			setState('context.currentGroupId', 'new-group')
			release()
			await render
			return document.getElementById('member-list').textContent
		}
		finally { release(); globalThis.fetch = originalFetch }
	})
	expect(result).toBe('new group')
})

test('local conversation opens while group refresh and federation rebind are pending', async ({ page, baseUrl, apiKey }) => {
	const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
	await waitForHub(page, baseUrl)
	let release
	const gate = new Promise(resolve => { release = resolve })
	await page.route(url => {
		const path = new URL(url).pathname
		return path.endsWith('/groups') || path.endsWith('/federation/rebind')
	}, async route => {
		await gate
		await route.continue()
	})
	try {
		await page.locator(`#server-list [data-group-id="${groupId}"]`).first().click()
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false, { timeout: 10_000 })
		await expect(page.locator('#messages .hub-empty-loading')).toHaveCount(0)
	}
	finally { release() }
})

test('invitation is visible in the conversation header and remains copyable without clipboard permission', async ({ page, baseUrl, apiKey }) => {
	await openFreshGroupChannel(page, baseUrl, apiKey)
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				/** 模拟剪贴板拒绝授权。 */
				writeText: async () => { throw new Error('permission denied') },
			},
		})
	})
	await page.locator('#header-invite-button').click()
	const link = page.locator('[data-invite-url]')
	await expect(link).toBeVisible()
	await expect(link).toHaveAttribute('readonly', '')
	await expect(link).not.toHaveValue('')
	await page.locator('[data-invite-copy]').click()
	await expect(link).toBeFocused()
	expect(await link.evaluate(input => input.selectionEnd - input.selectionStart)).toBeGreaterThan(0)
})

test('historical pagination uses bounded pages and transient failures stay retryable', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { store, setState } = await import('/parts/shells:chat/hub/core/state.mjs')
		const { loadOlderMessages } = await import('/parts/shells:chat/hub/messages/messageVirtualList.mjs')
		setState('context.currentGroupId', 'pagination-test')
		setState('context.currentChannelId', 'channel-test')
		store.messages.channelOlderExhausted = false
		store.messages.channelMessages = Array.from({ length: 1000 }, (_, index) => ({ eventId: `event-${index}` }))
		store.messages.channelMessagesSource = store.messages.channelMessages
		let limit
		const originalFetch = globalThis.fetch
		/** @param {string} url 记录分页大小后模拟临时网络故障。 */
		globalThis.fetch = async url => {
			limit = new URL(url, location.href).searchParams.get('limit')
			throw new TypeError('network temporarily unavailable')
		}
		try {
			await loadOlderMessages()
			return { limit, exhausted: store.messages.channelOlderExhausted }
		}
		finally { globalThis.fetch = originalFetch }
	})
	expect(result).toEqual({ limit: '50', exhausted: false })
})

test('messages load while drafts are pending and typing starts after restoration', async ({ page, baseUrl, apiKey }) => {
	const { groupId } = await openFreshGroupChannel(page, baseUrl, apiKey)
	await waitForHub(page, baseUrl)
	let release
	const gate = new Promise(resolve => { release = resolve })
	const draftRequest = page.waitForRequest(request => new URL(request.url()).pathname.includes('/drafts/'))
	await page.route(url => new URL(url).pathname.includes('/drafts/'), async route => {
		await gate
		await route.continue()
	})
	const messagesResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/view-log'))
	try {
		await page.locator(`#server-list [data-group-id="${groupId}"]`).first().click()
		await draftRequest
		expect((await messagesResponse).ok()).toBe(true)
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', true)
	}
	finally { release() }
	await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false)
})

test('existing user DM opens without identity discovery and resolves the peer name', async ({ page, groupChannel }) => {
	const { groupId } = groupChannel
	const entityHash = 'a'.repeat(128)
	await page.route(url => new URL(url).pathname.endsWith(`/entities/${entityHash}`), route => route.fulfill({
		status: 200, contentType: 'application/json', body: JSON.stringify({ profile: { entityHash, name: 'Peer Alice', avatar: null } }),
	}))
	await page.evaluate(async ({ groupId, entityHash }) => {
		const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
		const group = store.sidebar.groups.find(row => row.groupId === groupId)
		group.friendBinding = { entityHash, displayName: 'Alice' }
		const { dispatchFriendChat } = await import('/parts/shells:chat/hub/friendChat.mjs')
		await dispatchFriendChat({ type: 'user', entityHash, displayName: 'Alice' })
	}, { groupId, entityHash })
	await expect(page.locator('#group-name-display')).toHaveText('Peer Alice')
	await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false)
})

test('sending does not wait for an in-flight history refresh', async ({ page, groupChannel }) => {
	const { groupId, channelId } = groupChannel
	const initial = `before-refresh-${Date.now()}`
	await sendMessageViaComposer(page, groupId, channelId, initial)
	await expectMessageInChat(page, initial)
	let release
	const gate = new Promise(resolve => { release = resolve })
	const request = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/view-log') && new URL(request.url()).searchParams.has('since'))
	await page.route(url => new URL(url).pathname.endsWith('/view-log'), async route => {
		await gate
		await route.continue()
	})
	try {
		await page.evaluate(async () => {
			const { scheduleChannelIncrementalRefresh } = await import('/parts/shells:chat/hub/messages/messages.mjs')
			scheduleChannelIncrementalRefresh({ immediate: true })
		})
		await request
		const next = `during-refresh-${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, next)
		await expectMessageInChat(page, next)
	}
	finally { release() }
})

test('returning to a channel waits for its draft save while other drafts load independently', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { flushDraft, loadDraft } = await import('/parts/shells:chat/hub/composerDraft.mjs')
		document.body.innerHTML = '<textarea id="message-input"></textarea><div id="composer-extras"></div>'
		const originalFetch = globalThis.fetch
		const calls = []
		let savedText = 'old draft'
		let release, started
		const gate = new Promise(resolve => { release = resolve })
		const saving = new Promise(resolve => { started = resolve })
		/**
		 * 拦截草稿保存和读取，按频道记录请求先后。
		 * @param {string} url 请求地址
		 * @param {RequestInit} options 请求选项
		 * @returns {Promise<Response>} 伪造响应
		 */
		globalThis.fetch = async (url, options) => {
			const channel = decodeURIComponent(new URL(url, location.href).pathname.split('/').at(-1)).split(':').at(-1)
			calls.push(`${options.method} ${channel}`)
			if (options.method === 'PUT') {
				started()
				await gate
				savedText = JSON.parse(options.body).text
				calls.push('saved A')
			}
			return Response.json({ channel: options.method === 'GET' && channel === 'A' ? { text: savedText, files: [] } : null })
		}
		try {
			const write = flushDraft('draft-test', 'A', { text: 'new draft' })
			await saving
			const reload = loadDraft('draft-test', 'A')
			await loadDraft('draft-test', 'B')
			const beforeRelease = [...calls]
			release()
			await Promise.all([write, reload])
			return { beforeRelease, calls, restored: document.getElementById('message-input').value }
		}
		finally { release(); globalThis.fetch = originalFetch }
	})
	expect(result.beforeRelease).toEqual(['PUT A', 'GET B'])
	expect(result.calls).toEqual(['PUT A', 'GET B', 'saved A', 'GET A'])
	expect(result.restored).toBe('new draft')
})
