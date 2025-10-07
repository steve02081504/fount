import { console } from '../../../../../scripts/i18n.mjs'
import { showToast, showToastI18n } from '../../../../../scripts/toast.mjs'
import { addUserReply } from '../endpoints.mjs'
import { handleFilesSelect } from '../fileHandling.mjs'

import { addDragAndDropSupport } from './dragAndDrop.mjs'

const messageInputElement = document.getElementById('message-input')
const sendButtonElement = document.getElementById('send-button')
const fileInputElement = document.getElementById('file-input')
const attachmentPreviewContainer = document.getElementById('attachment-preview')
const uploadButtonElement = document.getElementById('upload-button')
const voiceButtonElement = document.getElementById('voice-button')
const photoButtonElement = document.getElementById('photo-button')

const SelectedFiles = []

let isRecording = false
let mediaRecorder
let audioChunks = []

export function initializeMessageInput() {
	uploadButtonElement.addEventListener('click', () => fileInputElement.click())
	fileInputElement.addEventListener('change', event => handleFilesSelect(event, SelectedFiles, attachmentPreviewContainer))
	addDragAndDropSupport(messageInputElement, SelectedFiles, attachmentPreviewContainer)
	sendButtonElement.addEventListener('click', sendMessage)
	messageInputElement.addEventListener('keydown', handleKeyPress)
	voiceButtonElement.addEventListener('click', toggleVoiceRecording)
	photoButtonElement.addEventListener('click', togglePhotoSection)
	messageInputElement.focus()
}

function handleKeyPress(event) {
	if (event.key === 'Enter' && event.ctrlKey) {
		event.preventDefault()
		sendMessage()
	}
}

function togglePhotoSection() {
	const input = document.createElement('input')
	input.type = 'file'
	input.accept = 'image/*'
	input.addEventListener('change', event => {
		const { files } = event.target
		if (files.length > 0)
			handleFilesSelect({ target: { files } }, SelectedFiles, attachmentPreviewContainer)
	})
	input.click()
}

async function toggleVoiceRecording() {
	if (isRecording) {
		mediaRecorder.stop()
		voiceButtonElement.innerHTML = await fetch('https://api.iconify.design/material-symbols/mic.svg').then(res => res.text())
		while (isRecording) {
			await new Promise(resolve => setTimeout(resolve, 100))
			isRecording = await isRecording
		}
	}
	else try { // Start recording
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		mediaRecorder = new MediaRecorder(stream)
		audioChunks = []

		mediaRecorder.ondataavailable = event => {
			audioChunks.push(event.data)
		}

		mediaRecorder.onstop = async () => {
			const audioBlob = new Blob(audioChunks, { type: 'audio/wav' })
			const audioFile = new File([audioBlob], `voice_message_${Date.now()}.wav`, { type: 'audio/wav' })

			// Simulate a file input change event to use handleFilesSelect
			const fakeEvent = {
				target: {
					files: [audioFile],
				},
			}
			stream.getTracks().forEach(track => track.stop())
			isRecording = await handleFilesSelect(fakeEvent, SelectedFiles, attachmentPreviewContainer)
		}

		mediaRecorder.start()
		voiceButtonElement.innerHTML = await fetch('https://api.iconify.design/line-md/square.svg').then(res => res.text())
		isRecording = true
	} catch (error) {
		console.error('Error accessing microphone:', error)
		showToastI18n('error', 'chat.voiceRecording.errorAccessingMicrophone')
	}
}

async function sendMessage() {
	const messageText = messageInputElement.value.trim()
	if (!messageText && !SelectedFiles.length) return

	if (isRecording) await toggleVoiceRecording()

	try {
		await addUserReply({ content: messageText, files: SelectedFiles })
		messageInputElement.value = ''
		SelectedFiles.length = 0
		attachmentPreviewContainer.innerHTML = ''
	}
	catch (error) {
		showToast('error', error.stack || error.message || error)
		console.error(error)
	}
}
