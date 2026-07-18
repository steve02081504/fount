/**
 * 【文件】public/hub/wiring/index.mjs
 * 【职责】Hub 页 DOM 事件委托薄聚合。
 */
import { showHubNavPane } from '../hubPane.mjs'
import { wireHubSearchPanel } from '../search.mjs'

import { wireComposerEvents } from './composerEvents.mjs'
import { handleMessageFileDownloadClick, wireFileEvents } from './fileEvents.mjs'
import { wireHeaderEvents, wireShiftKeyHint } from './headerEvents.mjs'
import { handleMessageBubbleClick } from './messageBubbleEvents.mjs'
import { handleVoteOptionClick, wireVoteEvents } from './voteEvents.mjs'

/** 注册 Hub 页面 DOM 事件委托。 @returns {void} */
export function wireEvents() {
	wireHeaderEvents()
	wireHubSearchPanel()
	wireComposerEvents()
	wireFileEvents()
	wireVoteEvents()

	document.getElementById('messages').addEventListener('click', async (event) => {
		if (event.target.closest('#friends-empty-search-button')) {
			// 移动端先露出频道栏；桌面侧栏已可见。label[for] 原生聚焦，再补一次以防 display:none→显示的时序。
			showHubNavPane()
			const input = document.getElementById('friends-search-input')
			if (input instanceof HTMLInputElement) {
				input.focus()
				requestAnimationFrame(() => input.focus())
			}
			return
		}
		if (await handleMessageBubbleClick(event)) return
		if (await handleMessageFileDownloadClick(event)) return
		if (await handleVoteOptionClick(event)) return
	})

	document.getElementById('messages').addEventListener('contextmenu', (event) => {
		const row = event.target.closest('.message[data-message-id]')
		if (!row) return
		void import('../messages/messageContextMenu.mjs').then(({ showMessageContextMenu }) =>
			showMessageContextMenu(event, row),
		)
	})

	wireShiftKeyHint()
}
