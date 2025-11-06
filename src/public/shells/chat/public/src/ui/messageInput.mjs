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

/**
 * 初始化消息输入框
 */
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

/**
 * 处理键盘按键事件。
 * @param {KeyboardEvent} event - 键盘事件对象。
 */
function handleKeyPress(event) {
	if (event.key === 'Enter' && event.ctrlKey) {
		event.preventDefault()
		sendMessage()
	}
}

/**
 * 触发照片选择
 */
function togglePhotoSection() {
	const input = document.createElement('input')
	input.type = 'file'
	input.accept = 'image/*'
	input.addEventListener('change', event => {
		const { files } = event.target
		if (files.length)
			handleFilesSelect({ target: { files } }, SelectedFiles, attachmentPreviewContainer)
	})
	input.click()
}

/**
 * 切换语音录制
 */
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

		/**
		 * 处理可用数据事件。
		 * @param {BlobEvent} event - 包含音频数据的 BlobEvent 对象。
		 */
		mediaRecorder.ondataavailable = event => {
			audioChunks.push(event.data)
		}

		/**
		 * 处理停止事件。
		 */
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

/**
 * 发送消息
 */
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
