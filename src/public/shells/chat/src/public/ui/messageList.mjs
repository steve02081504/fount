import { renderTemplate } from '../../../../../scripts/template.mjs'
import { renderMarkdown } from '../../../../../scripts/markdown.mjs'
import {
	modifyTimeLine,
	deleteMessage,
	editMessage,
} from '../endpoints.mjs'
import { handleFilesSelect, renderAttachmentPreview } from '../fileHandling.mjs'
import { processTimeStampForId, SWIPE_THRESHOLD, DEFAULT_AVATAR } from '../utils.mjs'
import { appendMessageToQueue, getQueueIndex, replaceMessageInQueue, getMessageIndexByIndex, deleteMessageInQueue } from './virtualQueue.mjs'
import { addDragAndDropSupport } from "./dragAndDrop.mjs"

const chatMessagesContainer = document.getElementById('chat-messages')

export async function renderMessage(message) {
	const preprocessedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: await renderMarkdown(message.content),
		safeTimeStamp: processTimeStampForId(message.timeStamp)
	}

	const messageElement = document.createElement('div')
	messageElement.innerHTML = await renderTemplate(
		'message_view',
		preprocessedMessage
	)
	const templateType = messageElement.firstChild.dataset.templateType

	if (templateType === 'message') {
		messageElement
			.querySelector('.delete-button')
			.addEventListener('click', async () => {
				if (confirm('确认删除此消息？')) {
					const index = getQueueIndex(messageElement)
					if (index === -1) return
					const messageIndex = await getMessageIndexByIndex(index)
					await deleteMessage(messageIndex)
					messageElement.remove()
					await deleteMessageInQueue(index)
				}
			})

		messageElement
			.querySelector('.edit-button')
			.addEventListener('click', async () => {
				const index = getQueueIndex(messageElement)
				if (index === -1) return
				const messageIndex = await getMessageIndexByIndex(index)
				await editMessageStart(message, index, messageIndex)
			})

		if (message.files?.length > 0) {
			const attachmentsContainer = messageElement.querySelector('.attachments')
			message.files.forEach(async (file, index) => {
				attachmentsContainer.appendChild(
					await renderAttachmentPreview(file, index, null)
				)
			})
		}
	}

	if (message.role == 'char')
		enableSwipe(messageElement)

	return messageElement
}

export async function editMessageStart(message, index, messageIndex) {
	let selectedFiles = message.files || []
	const editRenderedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content_for_edit: message.content_for_edit || message.content,
		safeTimeStamp: processTimeStampForId(message.timeStamp),
	}
	const messageElement = chatMessagesContainer.children[index]
	messageElement.innerHTML = await renderTemplate(
		'message_edit_view',
		editRenderedMessage
	)

	const templateType = messageElement.firstChild.dataset.templateType
	const fileEditInputElement = messageElement.querySelector(
		`#file-edit-input-${editRenderedMessage.safeTimeStamp}`
	)
	const attachmentEditPreviewContainer = messageElement.querySelector(
		`#attachment-edit-preview-${editRenderedMessage.safeTimeStamp}`
	)

	// 添加拖拽上传支持
	addDragAndDropSupport(
		messageElement.querySelector(
			`#edit-input-${editRenderedMessage.safeTimeStamp}`
		),
		selectedFiles,
		attachmentEditPreviewContainer
	)

	if (templateType === 'edit') {
		messageElement
			.querySelector(`#confirm-button-${editRenderedMessage.safeTimeStamp}`)
			.addEventListener('click', async () => {
				const newContent = messageElement.querySelector(
					`#edit-input-${editRenderedMessage.safeTimeStamp}`
				).value
				await replaceMessageInQueue(
					index,
					await editMessage(messageIndex, { content: newContent, files: selectedFiles })
				)
			})

		messageElement
			.querySelector(`#cancel-button-${editRenderedMessage.safeTimeStamp}`)
			.addEventListener('click', async () => {
				await replaceMessageInQueue(index, message)
			})

		selectedFiles.forEach(async (file, i) => {
			attachmentEditPreviewContainer.appendChild(
				await renderAttachmentPreview(file, i, selectedFiles)
			)
		})

		messageElement
			.querySelector(`#upload-edit-button-${editRenderedMessage.safeTimeStamp}`)
			.addEventListener('click', () => fileEditInputElement.click())

		fileEditInputElement.addEventListener('change', (event) => {
			handleFilesSelect(event, selectedFiles, attachmentEditPreviewContainer)
		})
	}

	messageElement
		.querySelector(`#edit-input-${editRenderedMessage.safeTimeStamp}`)
		.focus()
}

export async function appendMessage(message) {
	await appendMessageToQueue(message)
}

export async function replaceMessage(index, message) {
	await replaceMessageInQueue(index, message)
}

export function enableSwipe(messageElement) {
	let touchStartX = 0
	messageElement.addEventListener(
		'touchstart',
		(event) => {
			touchStartX = event.touches[0].clientX
		},
		{ passive: true }
	)

	messageElement.addEventListener(
		'touchend',
		async (event) => {
			const deltaX = event.changedTouches[0].clientX - touchStartX
			if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
				const index = getQueueIndex(messageElement)
				if (index === -1) return
				await replaceMessageInQueue(
					index,
					await modifyTimeLine(deltaX > 0 ? -1 : 1)
				)
			}
		},
		{ passive: true }
	)
}
