/**
 * 【文件】public/hub/composerFiles.mjs
 * 【职责】Hub 消息输入区附件与语音：待发送文件列表、预览条、选图与录音按钮状态切换。
 * 【原理】更新 `#attachment-preview`、`#voice-button` 图标，并对接 `handleFilesSelect` 拖拽/粘贴。发送时附件随 `sendCurrentMessage` 提交；不渲染历史消息行。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/template、../../../../scripts/toast、../src/composerAttachments
 */
import { confirmAction } from '../../../../scripts/features/promptDialog.mjs'
import { appendRecognizedText, hasSpeechRecognitionSource, recognizeBuffer } from '../../../../scripts/features/speechRecognition.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { startVoiceRecording } from '../../../../scripts/features/voiceRecord.mjs'
import { isTextComposer } from '/scripts/components/markdownRichInput.mjs'
import { handleFilesSelect } from '../src/composerAttachments.mjs'
import { renderTemplate } from '../src/templates.mjs'

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
/** @type {Promise<Awaited<ReturnType<typeof startVoiceRecording>>> | null} */
let voiceSessionPromise = null

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
 * @returns {Promise<{ file: object, element: HTMLElement }[]>} 新加入的附件及其预览元素
 */
export async function addFilesFromEvent(event) {
	const container = previewContainer()
	if (!container) return []
	return handleFilesSelect(event, selectedFiles, container, {
		onFilesChange: setComposerExtrasVisible,
	})
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
 * 恢复消息输入框为语音识别开始前的基础文本，并清理临时 dataset。
 * @returns {HTMLTextAreaElement|null} 输入框（不存在则为 null）
 */
function restoreComposerBase() {
	const input = document.getElementById('message-input')
	if (!isTextComposer(input)) return null
	const base = input.dataset.speechRecognitionBase ?? ''
	delete input.dataset.speechRecognitionBase
	input.value = base
	return input
}

/**
 * 录音结束后询问是否识别并填入输入框。
 * @param {object} fileObj 附件对象
 * @param {HTMLElement|undefined} attachmentElement 附件预览元素
 * @param {File} rawFile 原始文件
 * @returns {Promise<void>}
 */
async function maybeRecognizeVoiceAttachment(fileObj, attachmentElement, rawFile) {
	if (!await hasSpeechRecognitionSource()) return
	const ok = await confirmAction('chat.voiceRecording.confirmSpeechRecognition')
	if (!ok) return
	/** @type {{ text: string, language?: string } | null} */
	let result = null
	try {
		result = await recognizeBuffer({
			audio: rawFile,
			mime_type: rawFile.type,
			name: rawFile.name,
			/**
			 * @param {{ text: string }} partial 增量
			 * @returns {void}
			 */
			onPreview: (partial) => {
				const input = document.getElementById('message-input')
				if (isTextComposer(input)) {
					const base = input.dataset.speechRecognitionBase ?? input.value
					input.dataset.speechRecognitionBase = base
					input.value = base
						? `${base}${/\s$/.test(base) ? '' : ' '}${partial.text}`
						: partial.text
				}
			},
		})
		fileObj.description = result.text
		attachmentElement?.querySelector('.attachment-transcript')?.remove()
		const caption = document.createElement('p')
		caption.className = 'attachment-transcript text-xs opacity-70 mt-1'
		caption.textContent = result.text
		attachmentElement?.appendChild(caption)
	}
	catch (error) {
		showToastI18n('error', 'chat.voiceRecording.speechRecognitionFailed', { error: error?.message || String(error) })
	}
	finally {
		const input = restoreComposerBase()
		if (input && result) appendRecognizedText(input, result.text)
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
		const sessionPromise = voiceSessionPromise
		voiceSessionPromise = null
		isRecording = false
		await setVoiceBtnIcon(false)
		try {
			const session = await sessionPromise
			const file = await session?.stop()
			if (!file) return
			const [added] = await addFilesFromEvent({ target: { files: [file] } })
			if (added) await maybeRecognizeVoiceAttachment(added.file, added.element, file)
		}
		catch { /* 启动失败或 stop 失败时忽略 */ }
		return
	}

	isRecording = true
	const starting = startVoiceRecording()
	voiceSessionPromise = starting
	try {
		await starting
		if (voiceSessionPromise !== starting) return
		await setVoiceBtnIcon(true)
	}
	catch {
		if (voiceSessionPromise !== starting) return
		voiceSessionPromise = null
		isRecording = false
		await setVoiceBtnIcon(false)
		showToastI18n('error', 'chat.voiceRecording.errorAccessingMicrophone')
	}
}

/**
 * 若正在录音则先停止。
 * @returns {Promise<void>}
 */
export async function stopVoiceIfRecording() {
	if (!isRecording) return
	const sessionPromise = voiceSessionPromise
	voiceSessionPromise = null
	isRecording = false
	await setVoiceBtnIcon(false)
	try {
		const session = await sessionPromise
		await session?.stop()
	}
	catch { /* ignore */ }
}
