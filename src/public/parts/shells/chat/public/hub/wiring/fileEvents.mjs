import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { hasSpeechRecognitionSource, recognizeBuffer } from '/scripts/features/speechRecognition.mjs'
import { getCachedSpeechRecognitionTranscript, setCachedSpeechRecognitionTranscript } from '/scripts/features/speechRecognitionCache.mjs'
import { store } from '../core/state.mjs'
import { isFilesDrawerOpen, refreshFilesDrawer, setFilesDrawerOpen, wireFilesDrawerToggle } from '../files.mjs'

/** @returns {void} */
export function wireFileEvents() {
	document.getElementById('image-upload-input').addEventListener('change', async (event) => {
		const { files } = event.target
		if (!files?.length) return
		if (!store.privateGroup.groupId && (!store.context.currentGroupId || !store.context.currentChannelId)) return
		event.target.value = ''
		try {
			const { addFilesFromEvent } = await import('../composerFiles.mjs')
			if (store.context.currentGroupId && store.context.currentChannelId && store.context.fileHandlers && files.length === 1) {
				await store.context.fileHandlers.uploadGroupFile(files[0])
				return
			}
			await addFilesFromEvent({ target: { files } })
		}
		catch (err) {
			handleError('chat.hub.send.imageFailed')(err)
		}
	})

	document.getElementById('header-files-button').addEventListener('click', () => {
		if (!store.context.currentGroupId) {
			showToastI18n('warning', 'chat.hub.files.no.group')
			return
		}
		const open = !isFilesDrawerOpen()
		setFilesDrawerOpen(open)
		if (open)
			refreshFilesDrawer({
				groupId: store.context.currentGroupId,
				state: store.context.currentState,
				viewer: store.context.currentState?.viewer,
			}).catch(handleError('chat.hub.files.loadFailed'))
	})

	wireFilesDrawerToggle()
}

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleMessageFileDownloadClick(event) {
	const fileDownloadButton = event.target.closest('.message-file-download')
	if (!fileDownloadButton?.dataset?.groupFileId || !store.context.currentGroupId || !store.context.fileHandlers?.downloadGroupFile)
		return false
	const fileId = fileDownloadButton.dataset.groupFileId
	const fileRow = store.context.currentState?.files?.find(file => file.fileId === fileId)
	await store.context.fileHandlers.downloadGroupFile(fileId, fileRow?.name || fileId)
	return true
}

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleMessageFileAsrClick(event) {
	const button = event.target.closest('.message-file-speech-recognition')
	if (!button?.dataset?.groupFileId || !store.context.currentGroupId)
		return false
	if (!await hasSpeechRecognitionSource()) return true
	const fileId = button.dataset.groupFileId
	const block = button.closest('.message-inline-audio')
	const caption = block?.querySelector('.attachment-transcript')
	const cached = getCachedSpeechRecognitionTranscript(fileId)
	if (cached && caption instanceof HTMLElement) {
		caption.textContent = cached
		caption.classList.remove('hidden')
		return true
	}
	button.disabled = true
	try {
		const { fetchGroupFileAsBlob } = await import('../../src/groupFileBlob.mjs')
		const blob = await fetchGroupFileAsBlob(store.context.currentGroupId, fileId)
		const result = await recognizeBuffer({
			audio: blob,
			mime_type: blob.type,
			name: fileId,
		})
		setCachedSpeechRecognitionTranscript(fileId, result.text)
		if (caption instanceof HTMLElement) {
			caption.textContent = result.text
			caption.classList.remove('hidden')
		}
	}
	catch (error) {
		showToastI18n('error', 'chat.voiceRecording.speechRecognitionFailed', { error: error?.message || String(error) })
	}
	finally {
		button.disabled = false
	}
	return true
}
