/**
 * 【文件】public/hub/wireEvents.mjs
 * 【职责】Hub 页全局 DOM 事件委托：输入区、顶栏按钮、侧栏交互与模态触发器的集中注册点。
 * 【原理】绑定消息输入框自适应高度、附件/语音/投票/置顶等工具栏，以及创建/加入群组、模式切换等点击；通过 `submitComposer`、`loadMessages` 间接刷新频道视图；不拼装消息 HTML。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】hashNav、groupNav、messages、mode；依赖 i18n、template、groupApi、composerFiles 等。
 */
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import {
	castChannelVote,
	createChannelVote,
	getGroupState,
} from '../src/api/groupApi.mjs'
import { saveCustomEmojiFromRef } from '../src/customEmojis.mjs'
import { saveStickerFromMessage } from '../src/saveStickerFromMessage.mjs'
import { showTrustAuthorDialog } from '../src/trustAuthorDialog.mjs'
import { addDragAndDropSupport } from '../src/ui/dragAndDrop.mjs'

import {
	addFilesFromEvent,
	selectedFiles,
	pickPhoto,
	toggleVoiceRecording,
} from './composerFiles.mjs'
import { hubStore } from './core/state.mjs'
import { openFederationSettingsModal } from './federation/federationModal.mjs'
import { wireForkActions } from './federation/forkActions.mjs'
import { openFilesDrawer, wireFilesDrawerToggle } from './files.mjs'
import { showGroupHeaderMenu } from './groupContextMenu.mjs'
import { loadMessages } from './messages/messages.mjs'
import { wirePinsBookmarksPanels } from './pinsBookmarks.mjs'
import { wirePresenceInteractions } from './presence.mjs'
import { openGroupSettingsModal } from './privateGroup.mjs'
import { wireProfilePopupDismiss } from './profilePopup.mjs'

/** 注册 Hub 页面 DOM 事件委托。 @returns {void} */
export function wireEvents() {
	wirePresenceInteractions()
	wireProfilePopupDismiss()
	const messageInput = /** @type {HTMLTextAreaElement} */ document.getElementById('hub-message-input')
	addDragAndDropSupport(messageInput, selectedFiles, document.getElementById('hub-attachment-preview'))

	wirePinsBookmarksPanels()

	document.getElementById('hub-voice-button').addEventListener('click', () => {
		void toggleVoiceRecording()
	})

	document.getElementById('hub-photo-button').addEventListener('click', () => {
		pickPhoto()
	})

	document.getElementById('hub-upload-button').addEventListener('click', () => {
		document.getElementById('hub-image-upload-input').click()
	})

	document.getElementById('hub-image-upload-input').addEventListener('change', async (event) => {
		const {files} = event.target
		if (!files?.length) return
		if (!hubStore.privateGroup.groupId && (!hubStore.currentGroupId || !hubStore.currentChannelId)) return
		event.target.value = ''
		try {
			if (hubStore.currentGroupId && hubStore.currentChannelId && hubStore.fileHandlers && files.length === 1) {
				await hubStore.fileHandlers.uploadGroupFile(files[0])
				return
			}
			await addFilesFromEvent({ target: { files } })
		}
		catch (err) {
			showToastI18n('error', 'chat.hub.sendImageFailed', { error: err.message })
		}
	})

	const voteModal = /** @type {HTMLDialogElement} */ document.getElementById('hub-vote-modal')
	const voteQuestion = /** @type {HTMLInputElement} */ document.getElementById('hub-vote-question')
	const voteOptions = /** @type {HTMLTextAreaElement} */ document.getElementById('hub-vote-options')
	const voteHours = /** @type {HTMLInputElement} */ document.getElementById('hub-vote-hours')
	document.getElementById('hub-vote-button').addEventListener('click', () => {
		if (!hubStore.currentGroupId || !hubStore.currentChannelId) return
		voteQuestion.value = ''
		voteOptions.value = ''
		voteOptions.dataset.i18n = 'chat.hub.voteOptionDefault'
		voteHours.value = '24'
		voteModal.showModal()
	})
	document.getElementById('hub-vote-cancel-button').addEventListener('click', () => voteModal.close())
	document.getElementById('hub-vote-submit-button').addEventListener('click', async () => {
		if (!hubStore.currentGroupId || !hubStore.currentChannelId) return
		const question = voteQuestion.value.trim()
		if (!question) return
		const optsRaw = voteOptions.value
		const options = optsRaw.split(/[\n,，]/u).map(s => s.trim()).filter(Boolean)
		if (options.length < 2) {
			showToastI18n('error', 'chat.hub.voteMinOptions')
			return
		}
		const hoursVal = Number(voteHours.value)
		const deadlineMs = Number.isFinite(hoursVal) && hoursVal > 0 ? hoursVal * 3600 * 1000 : 0
		try {
			await createChannelVote(hubStore.currentGroupId, hubStore.currentChannelId, {
				question,
				options,
				deadlineMs: deadlineMs > 0 ? deadlineMs : undefined,
			})
			voteModal.close()
			await loadMessages()
		}
		catch (err) {
			showToastI18n('error', 'chat.hub.voteCreateFailed', { error: err.message })
		}
	})

	document.getElementById('hub-federation-settings-button').addEventListener('click', () => {
		void openFederationSettingsModal(() => hubStore.currentGroupId)
	})

	document.getElementById('hub-header-search').addEventListener('input', (event) => {
		const query = event.target.value.trim().toLowerCase()
		const chType = hubStore.currentState?.channels?.[hubStore.currentChannelId]?.type || 'text'
		if (hubStore.currentGroupId && hubStore.currentChannelId && chType === 'text') {
			hubStore.channelSearchQuery = query || null
			void (async () => {
				const { refreshChannelViewDom } = await import('./messages/messages.mjs')
				const container = document.getElementById('hub-messages')
				await refreshChannelViewDom(container, false)
			})()
			return
		}
		document.querySelectorAll('#hub-messages .hub-message, #hub-messages .hub-char-entry, #hub-messages .hub-system-message').forEach((element) => {
			element.style.display = !query || (element.textContent || '').toLowerCase().includes(query) ? '' : 'none'
		})
	})
	document.getElementById('hub-header-search').addEventListener('focus', (event) => {
		event.target.style.borderColor = 'var(--hub-accent)'
	})
	document.getElementById('hub-header-search').addEventListener('blur', (event) => {
		event.target.style.borderColor = 'transparent'
	})

	document.getElementById('hub-header-settings-button').addEventListener('click', () => {
		if (hubStore.privateGroup.groupId) openGroupSettingsModal(hubStore.privateGroup.groupId)
		else window.open('/parts/shells:chat/profile', '_blank', 'noopener')
	})

	document.getElementById('hub-header-files-button').addEventListener('click', async () => {
		if (!hubStore.currentGroupId) {
			showToastI18n('warning', 'chat.hub.filesNoGroup')
			return
		}
		if (!hubStore.fileHandlers) {
			showToastI18n('warning', 'chat.hub.filesNoChannel')
			return
		}
		const filesDrawerContext = { groupId: hubStore.currentGroupId, state: hubStore.currentState }
		const fileHandlers = {
			/**
			 * @param {File} file 待上传文件
			 * @param {string} [folderId] 目标文件夹
			 * @returns {Promise<void>}
			 */
			uploadGroupFile: (file, folderId) => hubStore.fileHandlers.uploadGroupFile(file, folderId),
			/**
			 * @param {string} fileId 群文件 ID
			 * @returns {Promise<void>}
			 */
			downloadGroupFile: (fileId) => {
				const row = hubStore.currentState?.files?.find(f => f.fileId === fileId)
				return hubStore.fileHandlers.downloadGroupFile(fileId, row?.name || fileId)
			},
			/** @returns {Promise<object>} 刷新后的群组 state */
			reloadState: async () => {
				hubStore.currentState = await getGroupState(hubStore.currentGroupId)
				return hubStore.currentState
			},
		}
		await openFilesDrawer(filesDrawerContext, fileHandlers)
	})

	document.getElementById('hub-group-header').addEventListener('click', (event) => {
		if (!hubStore.currentGroupId) return
		void showGroupHeaderMenu(event.currentTarget instanceof HTMLElement ? event.currentTarget : document.getElementById('hub-group-header'))
	})

	document.getElementById('hub-user-bar').addEventListener('click', (event) => {
		if (event.target.closest('a[href]')) return
		void import('./hubStatus.mjs').then(({ showStatusMenu }) =>
			showStatusMenu(document.getElementById('hub-user-bar')),
		)
	})

	document.getElementById('hub-messages').addEventListener('click', async (event) => {
		const trustAuthorButton = event.target.closest('.hub-trust-author-button')
		if (trustAuthorButton?.dataset?.authorPubKeyHash) {
			const authorDisplayName = trustAuthorButton.closest('.hub-message')
				?.querySelector('.hub-message-author')?.textContent
			const trusted = await showTrustAuthorDialog(
				trustAuthorButton.dataset.authorPubKeyHash,
				authorDisplayName,
			)
			if (trusted) {
				showToastI18n('success', 'chat.hub.trustOk')
				const messageRow = trustAuthorButton.closest('.hub-message[data-message-id]')
				const messageId = messageRow?.getAttribute('data-message-id')
				const container = document.getElementById('hub-messages')
				if (messageId) {
					const { hydrateMessageMarkdown } = await import('./messages/messageRender.mjs')
					await hydrateMessageMarkdown(container, messageId)
				}
			}
			return
		}
		const saveEmojiButton = event.target.closest('.hub-save-emoji-button')
		if (saveEmojiButton?.dataset?.emojiGroup && saveEmojiButton?.dataset?.emojiId) {
			await saveCustomEmojiFromRef(saveEmojiButton.dataset.emojiGroup, saveEmojiButton.dataset.emojiId)
			showToastI18n('success', 'chat.hub.saveEmojiOk')
			return
		}
		const saveStickerButton = event.target.closest('.hub-save-sticker-button')
		if (saveStickerButton) {
			const messageRow = saveStickerButton.closest('.hub-message[data-message-id]')
			const messageId = messageRow?.getAttribute('data-message-id')
			const channelMessage = hubStore.channelMessages.find(entry => String(entry.eventId) === messageId)
			if (!channelMessage?.content) return
			try {
				await saveStickerFromMessage(channelMessage.content)
				showToastI18n('success', 'chat.hub.saveStickerOk')
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.saveStickerFailed', { error: error.message })
			}
			return
		}
		const blockAuthorButton = event.target.closest('.hub-block-author-button')
		if (blockAuthorButton?.dataset?.blockPub && hubStore.currentGroupId) {
			if (!confirmI18n('chat.hub.blockConfirm')) return
			const response = await fetch('/api/p2p/blocklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					scope: 'subject',
					value: blockAuthorButton.dataset.blockPub,
					groupId: hubStore.currentGroupId,
				}),
			})
			if (!response.ok) {
				const data = await response.json().catch(() => ({}))
				showToastI18n('error', 'chat.hub.operationFailed', { error: data.error || response.statusText })
				return
			}
			showToastI18n('success', 'chat.hub.blockOk')
			return
		}
		const fileDownloadButton = event.target.closest('.hub-message-file-download')
		if (fileDownloadButton?.dataset?.groupFileId && hubStore.currentGroupId && hubStore.fileHandlers?.downloadGroupFile) {
			const fileId = fileDownloadButton.dataset.groupFileId
			const fileRow = hubStore.currentState?.files?.find(file => file.fileId === fileId)
			await hubStore.fileHandlers.downloadGroupFile(fileId, fileRow?.name || fileId)
			return
		}
		const voteOptionButton = event.target.closest('.hub-vote-option')
		if (voteOptionButton?.dataset?.ballotId && voteOptionButton?.dataset?.choice != null && hubStore.currentGroupId && hubStore.currentChannelId) {
			await castChannelVote(hubStore.currentGroupId, hubStore.currentChannelId, voteOptionButton.dataset.ballotId, voteOptionButton.dataset.choice)
			await loadMessages()
		}
	})

	document.getElementById('hub-messages').addEventListener('contextmenu', (event) => {
		const row = event.target.closest('.hub-message[data-message-id]')
		if (!row) return
		void import('./messages/messageContextMenu.mjs').then(({ showMessageContextMenu }) =>
			showMessageContextMenu(event, row),
		)
	})

	wireForkActions()
	wireFilesDrawerToggle()

	let shiftActive = false
	document.addEventListener('keydown', event => {
		if (event.key === 'Shift' && !shiftActive) {
			shiftActive = true
			document.body.classList.add('shift-active')
		}
	})
	document.addEventListener('keyup', event => {
		if (event.key === 'Shift') {
			shiftActive = false
			document.body.classList.remove('shift-active')
		}
	})
	window.addEventListener('blur', () => {
		shiftActive = false
		document.body.classList.remove('shift-active')
	})
}
