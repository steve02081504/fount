import { addDragAndDropSupport } from '../../src/ui/dragAndDrop.mjs'
import {
	pickPhoto,
	selectedFiles,
	toggleVoiceRecording,
} from '../composerFiles.mjs'
import { attachHubMentionAutocomplete } from '../mentionAutocomplete.mjs'

/** @returns {void} */
export function wireComposerEvents() {
	const messageInput = /** @type {HTMLTextAreaElement} */ document.getElementById('hub-message-input')
	addDragAndDropSupport(messageInput, selectedFiles, document.getElementById('hub-attachment-preview'))
	attachHubMentionAutocomplete(messageInput)

	document.getElementById('hub-voice-button').addEventListener('click', () => {
		void toggleVoiceRecording()
	})

	document.getElementById('hub-photo-button').addEventListener('click', () => {
		pickPhoto()
	})

	document.getElementById('hub-upload-button').addEventListener('click', () => {
		document.getElementById('hub-image-upload-input').click()
	})
}
