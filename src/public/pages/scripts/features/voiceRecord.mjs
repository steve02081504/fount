/**
 * 浏览器麦克风录音：返回 MediaRecorder 会话。
 * 产物 MIME 以浏览器实际为准（常为 webm/ogg），勿假定为 wav。
 */

/**
 * 开始录音。
 * @returns {Promise<{
 *   stop: () => Promise<File>,
 *   cancel: () => void,
 *   stream: MediaStream,
 *   mediaRecorder: MediaRecorder,
 * }>} 会话
 */
export async function startVoiceRecording() {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
		? 'audio/webm;codecs=opus'
		: MediaRecorder.isTypeSupported('audio/webm')
			? 'audio/webm'
			: ''
	const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
	/** @type {Blob[]} */
	const chunks = []
	/**
	 * @param {BlobEvent} event 数据块
	 * @returns {void}
	 */
	mediaRecorder.ondataavailable = event => {
		if (event.data?.size) chunks.push(event.data)
	}

	/** @type {(file: File) => void} */
	let resolveStop
	/** @type {(reason?: any) => void} */
	let rejectStop
	const stopped = new Promise((resolve, reject) => {
		resolveStop = resolve
		rejectStop = reject
	})

	/**
	 *
	 */
	mediaRecorder.onstop = () => {
		try {
			const type = mediaRecorder.mimeType || chunks[0]?.type || 'audio/webm'
			const blob = new Blob(chunks, { type })
			const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
			const file = new File([blob], `voice_message_${Date.now()}.${ext}`, { type })
			resolveStop(file)
		}
		catch (error) {
			rejectStop(error)
		}
		finally {
			stream.getTracks().forEach(track => track.stop())
		}
	}

	mediaRecorder.start(200)

	return {
		stream,
		mediaRecorder,
		/**
		 * @returns {Promise<File>} 录音文件
		 */
		stop: async () => {
			if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
			return stopped
		},
		/**
		 * @returns {void}
		 */
		cancel: () => {
			try {
				if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
			}
			catch { /* ignore */ }
			stream.getTracks().forEach(track => track.stop())
			rejectStop(new Error('cancelled'))
		},
	}
}
