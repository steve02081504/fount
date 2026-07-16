/**
 * 采集侧音频门限：RMS 迟滞 VAD，门关时不编码 = 零带宽。
 */
/* eslint-disable jsdoc/require-returns-description */

const STORAGE_KEY = 'fount.av.audioGateThreshold'
const DEFAULT_OPEN = 0.012
const DEFAULT_HANGOVER_MS = 600

/**
 * @returns {number} 开门 RMS 阈值
 */
export function loadAudioGateThreshold() {
	const raw = Number(localStorage.getItem(STORAGE_KEY))
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OPEN
}

/**
 * @param {number} value 阈值
 * @returns {void}
 */
export function saveAudioGateThreshold(value) {
	const n = Number(value)
	if (!Number.isFinite(n) || n <= 0) return
	localStorage.setItem(STORAGE_KEY, String(n))
}

/**
 * @param {Float32Array} samples 单声道 PCM
 * @returns {number} RMS 0..1
 */
export function pcmRms(samples) {
	if (!samples?.length) return 0
	let sum = 0
	for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
	return Math.sqrt(sum / samples.length)
}

/**
 * @param {AudioData} audioData WebCodecs 音频帧
 * @returns {number} RMS
 */
export function audioDataRms(audioData) {
	const plane = new Float32Array(audioData.numberOfFrames)
	audioData.copyTo(plane, { planeIndex: 0 })
	return pcmRms(plane)
}

/**
 * @param {object} [opts] 选项
 * @param {number} [opts.threshold] 开门阈值
 * @param {number} [opts.hangoverMs] 关门迟滞
 * @returns {{ update: (audioData: AudioData) => boolean, getLevel: () => number, isOpen: () => boolean, setThreshold: (n: number) => void }}
 */
export function createAudioGate(opts = {}) {
	let threshold = opts.threshold ?? loadAudioGateThreshold()
	const hangoverMs = opts.hangoverMs ?? DEFAULT_HANGOVER_MS
	let open = false
	let lastAbove = 0
	let level = 0

	return {
		/**
		 * @param {AudioData} audioData 帧
		 * @returns {boolean} 是否应编码发送
		 */
		update(audioData) {
			level = audioDataRms(audioData)
			const now = performance.now()
			if (level >= threshold) {
				open = true
				lastAbove = now
				return true
			}
			if (open && now - lastAbove < hangoverMs) return true
			open = false
			return false
		},
		/** @returns {number} 最近 RMS */
		getLevel: () => level,
		/** @returns {boolean} 门是否开 */
		isOpen: () => open,
		/**
		 * @param {number} n 新阈值
		 * @returns {void}
		 */
		setThreshold(n) {
			threshold = n
			saveAudioGateThreshold(n)
		},
	}
}
