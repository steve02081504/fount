import { renderTemplate } from '../../../../../scripts/template.mjs'
import { renderMarkdown } from '../../../../../scripts/markdown.mjs'
import {
	modifyTimeLine,
	deleteMessage,
	editMessage,
} from '../endpoints.mjs'
import { renderAttachmentPreview } from '../fileHandling.mjs'
import { processTimeStampForId, SWIPE_THRESHOLD, TRANSITION_DURATION, DEFAULT_AVATAR } from '../utils.mjs'

const chatMessagesContainer = document.getElementById('chat-messages')

export async function renderMessage(message) {
	const preprocessedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: renderMarkdown(message.content),
		safeTimeStamp: processTimeStampForId(message.timeStamp),
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
					const index = Array.from(chatMessagesContainer.children).indexOf(
						messageElement
					)
					await deleteMessage(index)
					messageElement.remove()
				}
			})

		messageElement
			.querySelector('.edit-button')
			.addEventListener('click', async () => {
				const index = Array.from(chatMessagesContainer.children).indexOf(
					messageElement
				)
				await editMessageStart(message, index)
			})

		if (message.files?.length > 0) {
			const attachmentsContainer = messageElement.querySelector('.attachments')
			message.files.forEach(async (file, index) => {
				attachmentsContainer.appendChild(
					await renderAttachmentPreview(file, index, attachmentsContainer)
				)
			})
		}
	}

	if (message.role !== 'char')
		messageElement.querySelectorAll('.arrow').forEach((arrow) => arrow.remove())
	else {
		enableSwipe(messageElement)
		messageElement.querySelectorAll('.arrow').forEach((arrow) => {
			arrow.addEventListener('click', async () => {
				const index = Array.from(chatMessagesContainer.children).indexOf(
					messageElement
				)
				await replaceMessage(
					index,
					await modifyTimeLine(arrow.classList.contains('left') ? -1 : 1)
				)
			})
		})
	}

	return messageElement
}

export async function editMessageStart(message, index) {
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

	// 添加拖拽上传支持
	addDragAndDropSupport(
		messageElement.querySelector(
			`#edit-input-${editRenderedMessage.safeTimeStamp}`
		)
	)

	const templateType = messageElement.firstChild.dataset.templateType
	const fileEditInputElement = messageElement.querySelector(
		`#file-edit-input-${editRenderedMessage.safeTimeStamp}`
	)
	const attachmentEditPreviewContainer = messageElement.querySelector(
		`#attachment-edit-preview-${editRenderedMessage.safeTimeStamp}`
	)

	if (templateType === 'edit') {
		messageElement
			.querySelector(`#confirm-button-${editRenderedMessage.safeTimeStamp}`)
			.addEventListener('click', async () => {
				const newContent = messageElement.querySelector(
					`#edit-input-${editRenderedMessage.safeTimeStamp}`
				).value
				await replaceMessage(
					index,
					await editMessage(index, { content: newContent, files: selectedFiles })
				)
			})

		messageElement
			.querySelector(`#cancel-button-${editRenderedMessage.safeTimeStamp}`)
			.addEventListener('click', async () => {
				await replaceMessage(index, message)
			})

		selectedFiles.forEach(async (file, i) => {
			attachmentEditPreviewContainer.appendChild(
				await renderAttachmentPreview(file, i, attachmentEditPreviewContainer)
			)
		})

		messageElement
			.querySelector(`#upload-edit-button-${editRenderedMessage.safeTimeStamp}`)
			.addEventListener('click', () => fileEditInputElement.click())

		fileEditInputElement.addEventListener('change', handleFilesSelect)
	}

	messageElement
		.querySelector(`#edit-input-${editRenderedMessage.safeTimeStamp}`)
		.focus()
}

export async function appendMessage(message) {
	chatMessagesContainer.querySelectorAll('.arrow').forEach((arrow) => arrow.remove())
	const messageElement = await renderMessage(message)
	chatMessagesContainer.appendChild(messageElement)
	chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
}

export async function replaceMessage(index, message) {
	const oldMessageElement = chatMessagesContainer.children[index]
	if (!oldMessageElement) return

	const newMessageElement = await renderMessage(message)
	if (index != chatMessagesContainer.children.length - 1)
		// 不是最后一条消息
		newMessageElement.querySelectorAll('.arrow').forEach((arrow) => arrow.remove())
	oldMessageElement.classList.add('smooth-transition')
	oldMessageElement.style.opacity = '0'

	await new Promise((resolve) => setTimeout(resolve, TRANSITION_DURATION))

	oldMessageElement.replaceWith(newMessageElement)
	newMessageElement.style.opacity = '1'
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
				const index = Array.from(chatMessagesContainer.children).indexOf(
					messageElement
				)
				await replaceMessage(
					index,
					await modifyTimeLine(deltaX > 0 ? -1 : 1)
				)
			}
		},
		{ passive: true }
	)
}
