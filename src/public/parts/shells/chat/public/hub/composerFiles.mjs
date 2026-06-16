/**
 * 【文件】public/hub/composerFiles.mjs
 * 【职责】Hub 消息输入区附件与语音：待发送文件列表、预览条、选图与录音按钮状态切换。
 * 【原理】更新 `#hub-attachment-preview`、`#hub-voice-button` 图标，并对接 `handleFilesSelect` 拖拽/粘贴。发送时附件随 `sendCurrentMessage` 提交；不渲染历史消息行。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/template、../../../../scripts/toast、../src/composerAttachments
 */
import { renderTemplate } from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { handleFilesSelect } from '../src/composerAttachments.mjs'

/** @type {Array<object>} Hub 输入区待发送附件 */
export const selectedFiles = []

/**
 * @param {boolean} recording 是否正在录音
 * @returns {Promise<void>}
 */
async function setVoiceBtnIcon(recording) {
	const voiceButton = document.getElementById('hub-voice-button')
	if (!voiceButton) return
	voiceButton.replaceChildren()
	voiceButton.appendChild(await renderTemplate(
		recording ? 'hub/composer/icon_record_stop' : 'hub/composer/icon_mic',
		{},
	))
}

let isRecording = false
/** @type {MediaRecorder|null} */
let mediaRecorder = null
/** @type {Blob[]} */
let audioChunks = []

/**
 * @returns {HTMLElement|null} 附件预览容器
 */
function previewContainer() {
	return document.getElementById('hub-attachment-preview')
}

/**
 * 清空附件预览与缓冲。
 * @returns {void}
 */
export function clearSelectedFiles() {
	selectedFiles.length = 0
	const el = previewContainer()
	if (el) el.innerHTML = ''
}

/**
 * @param {Event} event 文件选择或拖放事件
 * @returns {Promise<void>}
 */
export async function addFilesFromEvent(event) {
	const container = previewContainer()
	if (!container) return
	await handleFilesSelect(event, selectedFiles, container)
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
 * 切换语音录制。
 * @returns {Promise<void>}
 */
export async function toggleVoiceRecording() {
	const voiceButton = document.getElementById('hub-voice-button')
	if (!voiceButton) return

	if (isRecording) {
		mediaRecorder?.stop()
		await setVoiceBtnIcon(false)
		while (isRecording)
			await new Promise(r => setTimeout(r, 100))

		return
	}

	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		mediaRecorder = new MediaRecorder(stream)
		audioChunks = []
		/**
		 * @param {BlobEvent} e 录音数据块事件
		 * @returns {void}
		 */
		mediaRecorder.ondataavailable = e => { audioChunks.push(e.data) }
		/**
		 * 录音结束：组装 wav 文件并加入待发附件队列。
		 * @returns {Promise<void>}
		 */
		mediaRecorder.onstop = async () => {
			const audioBlob = new Blob(audioChunks, { type: 'audio/wav' })
			const audioFile = new File([audioBlob], `voice_message_${Date.now()}.wav`, { type: 'audio/wav' })
			stream.getTracks().forEach(t => t.stop())
			isRecording = false
			await addFilesFromEvent({ target: { files: [audioFile] } })
		}
		mediaRecorder.start()
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
	if (isRecording && mediaRecorder) {
		mediaRecorder.stop()
		while (isRecording)
			await new Promise(r => setTimeout(r, 50))
	}
}
