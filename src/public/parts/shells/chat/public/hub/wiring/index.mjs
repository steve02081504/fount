/**
 * 【文件】public/hub/wiring/index.mjs
 * 【职责】Hub 页 DOM 事件委托薄聚合。
 */
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

	document.getElementById('hub-messages').addEventListener('click', async (event) => {
		if (await handleMessageBubbleClick(event)) return
		if (await handleMessageFileDownloadClick(event)) return
		if (await handleVoteOptionClick(event)) return
	})

	document.getElementById('hub-messages').addEventListener('contextmenu', (event) => {
		const row = event.target.closest('.hub-message[data-message-id]')
		if (!row) return
		void import('../messages/messageContextMenu.mjs').then(({ showMessageContextMenu }) =>
			showMessageContextMenu(event, row),
		)
	})

	wireShiftKeyHint()
}
