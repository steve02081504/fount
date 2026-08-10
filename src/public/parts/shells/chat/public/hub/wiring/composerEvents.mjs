import { addDragAndDropSupport, addMessageAreaFileDrop } from '../../src/ui/dragAndDrop.mjs'
import {
	pickPhoto,
	selectedFiles,
	toggleVoiceRecording,
} from '../composerFiles.mjs'
import { store } from '../core/state.mjs'
import { attachHubMentionAutocomplete } from '../mentionAutocomplete.mjs'

/** @returns {void} */
export function wireComposerEvents() {
	const messageInput = /** @type {HTMLTextAreaElement} */ document.getElementById('message-input')
	const preview = document.getElementById('attachment-preview')
	addDragAndDropSupport(messageInput, selectedFiles, preview)
	attachHubMentionAutocomplete(messageInput)

	const dropRoot = document.querySelector('.main-body')
		|| document.getElementById('messages')?.parentElement
	if (dropRoot instanceof HTMLElement)
		addMessageAreaFileDrop(dropRoot, selectedFiles, preview, () => {
			const channelId = store.context.currentChannelId
			const channel = store.context.currentState?.channels?.[channelId]
			return channel?.name || channelId || ''
		})

	document.getElementById('voice-button').addEventListener('click', () => {
		void toggleVoiceRecording()
	})

	document.getElementById('photo-button').addEventListener('click', () => {
		pickPhoto()
	})

	document.getElementById('upload-button').addEventListener('click', () => {
		document.getElementById('image-upload-input').click()
	})
}
