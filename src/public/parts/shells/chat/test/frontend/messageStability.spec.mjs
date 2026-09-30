import { test, expect } from './fixtures.mjs'

test('delivery confirmation and repeated echoes preserve the mounted message body', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { createMessageSurfacePipeline } = await import('/parts/shells:chat/hub/messages/messageSurface.mjs')
		const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
		const sender = 'a'.repeat(64)
		store.context.currentState = { viewerMemberPubKeyHash: sender, members: [] }
		const content = { content: '**stable message**', extension: { chat: { clientMessageId: 'stable-send' } } }
		let messages = [{ eventId: 'pending:stable-send', type: 'message', sender, authorPubKeyHash: sender, timestamp: 1, content, pending: true, deliveryStatus: 'pending' }]
		const container = document.createElement('div')
		document.body.append(container)
		const pipeline = createMessageSurfacePipeline({
			container,
			/** @returns {object[]} Rows */
			getMessages: () => messages,
			/** @returns {object} Render options */
			getRenderOpts: () => ({ viewerPubKeyHash: sender }),
			/** @returns {void} Decoration */
			onDecorate: () => {},
		})
		try {
			await pipeline.refresh()
			const originalRow = container.querySelector('.message-row')
			const originalBody = originalRow.querySelector('.message-content')
			const originalText = originalBody.querySelector('strong').firstChild
			const selection = window.getSelection()
			const range = document.createRange()
			range.selectNodeContents(originalText)
			selection.removeAllRanges()
			selection.addRange(range)
			messages = [{ ...messages[0], eventId: 'b'.repeat(64), pending: false, deliveryStatus: 'sent', timestamp: 2, seq: 1 }]
			await pipeline.refresh()
			const confirmed = container.querySelector('.message-row')
			const confirmationPreserved = confirmed === originalRow && confirmed.querySelector('.message-content') === originalBody
			// A view-log echo adds metadata and can order object fields differently.
			messages = [{ ...messages[0], seq: 2, content: { extension: content.extension, content: content.content } }]
			await pipeline.replaceItem(0, messages[0])
			await pipeline.refresh()
			const echoed = container.querySelector('.message-row')
			const echoPreserved = echoed === originalRow && echoed.querySelector('.message-content') === originalBody
			const selectedText = selection.toString()
			const confirmedId = echoed.dataset.messageId
			const pending = echoed.hasAttribute('data-pending')
			const sentStatus = !!echoed.querySelector('.delivery-status--sent')
			messages = [{ ...messages[0], content: { ...content, content: '**edited message**' }, wasEdited: true }]
			await pipeline.refresh()
			return { confirmationPreserved, echoPreserved, selectedText, confirmedId, pending, sentStatus, editedText: container.querySelector('.message-content').textContent }
		}
		finally {
			pipeline.destroy()
			container.remove()
		}
	})
	expect(result.confirmationPreserved).toBe(true)
	expect(result.echoPreserved).toBe(true)
	expect(result.selectedText).toBe('stable message')
	expect(result.confirmedId).toBe('b'.repeat(64))
	expect(result.pending).toBe(false)
	expect(result.sentStatus).toBe(true)
	expect(result.editedText).toContain('edited message')
})

test('composer sends keep their first painted body through HTTP confirmation and view-log echoes', async ({ page, groupChannel }) => {
	test.setTimeout(600_000)
	expect(groupChannel.channelId).toBeTruthy()
	const results = await page.evaluate(async () => {
		const { sendMessagePayload } = await import('/parts/shells:chat/hub/messages/messageSend.mjs')
		const { refreshChannelMessagesIncremental } = await import('/parts/shells:chat/hub/messages/messageRefresh.mjs')
		const container = document.getElementById('messages')
		const results = []
		for (const content of ['**first stable send**', '**second stable send**']) {
			let originalRow = null
			let originalBody = null
			const observer = new MutationObserver(() => {
				if (originalRow) return
				originalRow = container.querySelector('.message-row[data-pending="1"]')
				originalBody = originalRow?.querySelector('.message-content')
			})
			observer.observe(container, { childList: true, subtree: true })
			try {
				const event = await sendMessagePayload({ content })
				await refreshChannelMessagesIncremental()
				await refreshChannelMessagesIncremental()
				const row = container.querySelector(`.message-row[data-message-id="${event.id}"]`)
				results.push({ rowPreserved: !!row && row === originalRow, bodyPreserved: !!originalBody && row?.querySelector('.message-content') === originalBody, count: container.querySelectorAll(`.message-row[data-message-id="${event.id}"]`).length })
			}
			finally {
				observer.disconnect()
			}
		}
		return results
	})
	for (const result of results) {
		expect(result.rowPreserved).toBe(true)
		expect(result.bodyPreserved).toBe(true)
		expect(result.count).toBe(1)
	}
})

test('incremental echoes preserve other pending sends and local attachment buffers', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { mergeIncrementalSourceBatch } = await import('/parts/shells:chat/hub/messages/channelMessageStore.mjs')
		const first = { eventId: 'pending:first', sender: 'local', pending: true, timestamp: 1, type: 'message', content: { content: 'first', extension: { chat: { clientMessageId: 'first' } }, files: [{ fileId: '', name: 'image.png', mime_type: 'image/png', buffer: 'aGVsbG8=' }] } }
		const second = { eventId: 'pending:second', sender: 'local', pending: true, sendFailed: true, timestamp: 2, type: 'message', content: { content: 'second', extension: { chat: { clientMessageId: 'second' } } } }
		const echo = { ...first, eventId: 'c'.repeat(64), pending: false, content: { ...first.content, files: [{ fileId: 'd'.repeat(64), name: 'image.png', mime_type: 'image/png' }] } }
		const merged = mergeIncrementalSourceBatch([first, second], [echo])
		const afterAnotherEcho = mergeIncrementalSourceBatch(merged, [echo])
		const otherAuthorEcho = { ...echo, eventId: 'e'.repeat(64), sender: 'other', content: second.content }
		const foreignMerged = mergeIncrementalSourceBatch([second], [otherAuthorEcho])
		return { ids: afterAnotherEcho.map(row => row.eventId), buffer: afterAnotherEcho.find(row => row.eventId === echo.eventId)?.content.files[0].buffer, foreignPendingPreserved: foreignMerged.some(row => row.eventId === second.eventId) }
	})
	expect(result.ids).toEqual(['c'.repeat(64), 'pending:second'])
	expect(result.buffer).toBe('aGVsbG8=')
	expect(result.foreignPendingPreserved).toBe(true)
})
