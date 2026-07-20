import { addDragAndDropSupport } from '../../src/ui/dragAndDrop.mjs'
import {
	pickPhoto,
	selectedFiles,
	toggleVoiceRecording,
} from '../composerFiles.mjs'
import { attachHubMentionAutocomplete } from '../mentionAutocomplete.mjs'

/** @returns {void} */
export function wireComposerEvents() {
	const messageInput = /** @type {HTMLTextAreaElement} */ document.getElementById('message-input')
	addDragAndDropSupport(messageInput, selectedFiles, document.getElementById('attachment-preview'))
	attachHubMentionAutocomplete(messageInput)

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
