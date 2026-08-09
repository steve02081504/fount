/**
 * 【文件】public/hub/composerFiles.mjs
 * 【职责】Hub 消息输入区附件与语音：待发送文件列表、预览条、选图与录音按钮状态切换。
 * 【原理】更新 `#attachment-preview`、`#voice-button` 图标，并对接 `handleFilesSelect` 拖拽/粘贴。发送时附件随 `sendCurrentMessage` 提交；不渲染历史消息行。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/template、../../../../scripts/toast、../src/composerAttachments
 */
import { appendRecognizedText, hasSpeechRecognitionSource, recognizeBuffer } from '../../../../scripts/features/speechRecognition.mjs'
import { confirmAction } from '../../../../scripts/features/promptDialog.mjs'
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { startVoiceRecording } from '../../../../scripts/features/voiceRecord.mjs'
import { handleFilesSelect } from '../src/composerAttachments.mjs'

import { setComposerExtrasVisible } from './composerExtras.mjs'

/** @type {Array<object>} Hub 输入区待发送附件 */
export const selectedFiles = []

/**
 * @param {boolean} recording 是否正在录音
 * @returns {Promise<void>}
 */
async function setVoiceBtnIcon(recording) {
	const voiceButton = document.getElementById('voice-button')
	if (!voiceButton) return
	voiceButton.replaceChildren()
	voiceButton.appendChild(await renderTemplate(
		recording ? 'hub/composer/icon_record_stop' : 'hub/composer/icon_mic',
		{},
	))
}

let isRecording = false
/** @type {Awaited<ReturnType<typeof startVoiceRecording>> | null} */
let voiceSession = null

/**
 * @returns {HTMLElement|null} 附件预览容器
 */
function previewContainer() {
	return document.getElementById('attachment-preview')
}

/**
 * 清空附件预览与缓冲。
 * @returns {void}
 */
export function clearSelectedFiles() {
	selectedFiles.length = 0
	const el = previewContainer()
	if (el) el.innerHTML = ''
	setComposerExtrasVisible(false)
}

/**
 * @param {Event} event 文件选择或拖放事件
 * @returns {Promise<object[]>} 新加入的附件对象
 */
export async function addFilesFromEvent(event) {
	const container = previewContainer()
	if (!container) return []
	const before = selectedFiles.length
	await handleFilesSelect(event, selectedFiles, container)
	if (selectedFiles.length) setComposerExtrasVisible(true)
	return selectedFiles.slice(before)
}

/**
 * 触发图片文件选择。
 * @returns {void}
 */
export function pickPhoto() {
	const input = document.createElement('input')
	input.type = 'file'
	input.accept = 'image/*'
	input.addEventListener('change', event => {
		if (event.target.files?.length)
			void addFilesFromEvent({ target: { files: event.target.files } })
	})
	input.click()
}

/**
 * 录音结束后询问是否识别并填入输入框。
 * @param {object} fileObj 附件对象
 * @param {File} rawFile 原始文件
 * @returns {Promise<void>}
 */
async function maybeRecognizeVoiceAttachment(fileObj, rawFile) {
	if (!await hasSpeechRecognitionSource()) return
	const ok = await confirmAction('chat.voiceRecording.confirmSpeechRecognition')
	if (!ok) return
	try {
		const result = await recognizeBuffer({
			audio: rawFile,
			mime_type: rawFile.type,
			name: rawFile.name,
			/**
			 * @param {{ text: string }} partial 增量
			 * @returns {void}
			 */
			onPreview: (partial) => {
				const input = document.getElementById('message-input')
				if (input instanceof HTMLTextAreaElement) {
					const base = input.dataset.speechRecognitionBase ?? input.value
					input.dataset.speechRecognitionBase = base
					input.value = base
						? `${base}${/\s$/.test(base) ? '' : ' '}${partial.text}`
						: partial.text
				}
			},
		})
		const input = document.getElementById('message-input')
		if (input instanceof HTMLTextAreaElement) {
			const base = input.dataset.speechRecognitionBase ?? ''
			delete input.dataset.speechRecognitionBase
			input.value = base
			appendRecognizedText(input, result.text)
		}
		fileObj.description = result.text
		const preview = document.getElementById(`attachment-${CSS.escape?.(fileObj.name) || fileObj.name}`)
			|| document.querySelector(`[id^="attachment-"][id*="${CSS.escape?.(String(selectedFiles.indexOf(fileObj))) || ''}"]`)
		preview?.querySelector('.attachment-transcript')?.remove()
		const caption = document.createElement('p')
		caption.className = 'attachment-transcript text-xs opacity-70 mt-1'
		caption.textContent = result.text
		preview?.appendChild(caption)
	}
	catch (error) {
		showToastI18n('error', 'chat.voiceRecording.speechRecognitionFailed', { error: error?.message || String(error) })
	}
}

/**
 * 切换语音录制。
 * @returns {Promise<void>}
 */
export async function toggleVoiceRecording() {
	const voiceButton = document.getElementById('voice-button')
	if (!voiceButton) return

	if (isRecording) {
		const session = voiceSession
		voiceSession = null
		await setVoiceBtnIcon(false)
		isRecording = false
		const file = await session?.stop()
		if (!file) return
		const added = await addFilesFromEvent({ target: { files: [file] } })
		const fileObj = added[0]
		if (fileObj) await maybeRecognizeVoiceAttachment(fileObj, file)
		return
	}

	try {
		voiceSession = await startVoiceRecording()
		await setVoiceBtnIcon(true)
		isRecording = true
	}
	catch {
		showToastI18n('error', 'chat.voiceRecording.errorAccessingMicrophone')
	}
}

/**
 * 若正在录音则先停止。
 * @returns {Promise<void>}
 */
export async function stopVoiceIfRecording() {
	if (isRecording && voiceSession) {
		const session = voiceSession
		voiceSession = null
		isRecording = false
		await setVoiceBtnIcon(false)
		await session.stop().catch(() => null)
	}
}
