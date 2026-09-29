import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	messageTextFromPostResponse,
	navigateGroupChannelHash,
} from './fixtures.mjs'

test.describe('Chat hub integration', () => {
	test.describe.configure({ timeout: 600_000 })

	test('composer, navigation, profile, and smoke checks', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)

		const text = `playwright e2e ${Date.now()}`
		const postJson = await sendMessageViaComposer(page, groupId, channelId, text)
		expect(postJson.event?.type).toBe('message')
		expect(messageTextFromPostResponse(postJson)).toBe(text)

		await page.locator('.server-item[data-mode="friends"]').click()
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', true, { timeout: 30_000 })
		await navigateGroupChannelHash(page, groupId, channelId)

		await page.locator('#toggle-members-button').click()
		await expect(page.locator('#member-bar')).toHaveClass(/member-bar--open/)

		const searchText = `search-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, searchText)
		await expectMessageInChat(page, searchText)

		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})

	test('message list recovers after #messages replaced via placeholder', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `placeholder regression ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await expectMessageInChat(page, text)

		const outcome = await page.evaluate(async () => {
			const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { mountMessagesPlaceholder } = await import('/parts/shells:chat/hub/messages/messagesPlaceholder.mjs')
			const { initChannelVirtualList } = await import('/parts/shells:chat/hub/messages/messageVirtualList.mjs')
			const container = document.getElementById('messages')

			const hadPipeline = !!store.messages.channelMessagePipeline
			// 占位入口必须先销毁管道再替换 DOM，避免管道继续渲染进分离的旧容器。
			await mountMessagesPlaceholder(container, 'hub/empty/loading', {})
			const pipelineCleared = !store.messages.channelMessagePipeline && !store.messages.channelPipelineKey

			// 重新建管道并等初始 refresh 落地，再模拟「管道存活时容器被清空」的旧故障场景。
			initChannelVirtualList(container)
			await store.messages.channelMessagePipeline.refresh()
			container.innerHTML = ''

			const sample = store.messages.channelMessages.at(-1) || store.messages.channelMessagesSource.at(-1)
			let done = false
			const work = (async () => {
				// 旧实现在此处 appendItem -> refresh -> getMutex 等待自身锁而永久挂起
				await store.messages.channelMessagePipeline.appendItem(sample, false)
				done = true
			})()
			await Promise.race([
				work,
				new Promise((_, reject) => setTimeout(() => reject(new Error('virtual list deadlock')), 5000)),
			])
			return { hadPipeline, pipelineCleared, done, rows: container.querySelectorAll('.message').length }
		})

		expect(outcome.hadPipeline).toBe(true)
		expect(outcome.pipelineCleared).toBe(true)
		expect(outcome.done).toBe(true)
		expect(outcome.rows).toBeGreaterThan(0)
	})
})
