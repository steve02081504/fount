import { addDragAndDropSupport, addMessageAreaFileDrop } from '../../src/ui/dragAndDrop.mjs'
import { setComposerExtrasVisible } from '../composerExtras.mjs'
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
	const fileOpts = { onFilesChange: setComposerExtrasVisible }
	addDragAndDropSupport(messageInput, selectedFiles, preview, fileOpts)
	attachHubMentionAutocomplete(messageInput)

	addMessageAreaFileDrop(document.querySelector('.main-body'), selectedFiles, preview, () => {
		const channelId = store.context.currentChannelId
		return store.context.currentState?.channels?.[channelId]?.name || channelId || ''
	}, fileOpts)

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
