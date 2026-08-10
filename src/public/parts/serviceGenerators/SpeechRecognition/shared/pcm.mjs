/**
 * PCM / WAV 与语言码小工具（语音识别生成器共用）。
 */

/** 16 位 PCM 衰减除数（避免削波）。 */
export const ATTENUATION_DIVISOR = 3

/**
 * 规范化语言码供各厂商使用。
 * @param {string | undefined} lang 语言
 * @param {'short' | 'zh_cn' | 'auto'} [style='short'] 风格
 * @returns {string} 规范化结果
 */
export function normalizeLang(lang, style = 'short') {
	const lower = String(lang || '').trim().toLowerCase()
	if (!lower || lower === 'auto') {
		if (style === 'auto') return 'auto'
		if (style === 'zh_cn') return 'zh_cn'
		return 'zh'
	}
	if (style === 'zh_cn') {
		if (lower.startsWith('zh')) return 'zh_cn'
		if (lower.startsWith('en')) return 'en_us'
		return lower.replace('-', '_')
	}
	if (style === 'auto') {
		if (lower.startsWith('zh')) return 'zh'
		if (lower.startsWith('en')) return 'en'
		return 'auto'
	}
	if (lower.startsWith('zh')) return 'zh'
	return lower.length >= 2 ? lower.slice(0, 2) : lower
}

/**
 * 写小端 u16。
 * @param {Uint8Array} bytes 缓冲
 * @param {number} offset 偏移
 * @param {number} value 值
 * @returns {void}
 */
function putLE16(bytes, offset, value) {
	bytes[offset] = value & 0xff
	bytes[offset + 1] = (value >> 8) & 0xff
}

/**
 * 写小端 u32。
 * @param {Uint8Array} bytes 缓冲
 * @param {number} offset 偏移
 * @param {number} value 值
 * @returns {void}
 */
function putLE32(bytes, offset, value) {
	bytes[offset] = value & 0xff
	bytes[offset + 1] = (value >> 8) & 0xff
	bytes[offset + 2] = (value >> 16) & 0xff
	bytes[offset + 3] = (value >> 24) & 0xff
}

/**
 * 将 PCM s16le 包成 WAV。
 * @param {Uint8Array} pcm PCM 数据
 * @param {number} [sampleRate=16000] 采样率
 * @param {number} [channels=1] 声道
 * @returns {Uint8Array} WAV 字节
 */
export function pcmToWav(pcm, sampleRate = 16000, channels = 1) {
	const dataSize = pcm.byteLength
	const byteRate = sampleRate * channels * 2
	const blockAlign = channels * 2
	const header = new Uint8Array(44)
	header.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
	putLE32(header, 4, 36 + dataSize)
	header.set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
	header.set([0x66, 0x6d, 0x74, 0x20], 12) // fmt
	putLE32(header, 16, 16)
	putLE16(header, 20, 1)
	putLE16(header, 22, channels)
	putLE32(header, 24, sampleRate)
	putLE32(header, 28, byteRate)
	putLE16(header, 32, blockAlign)
	putLE16(header, 34, 16)
	header.set([0x64, 0x61, 0x74, 0x61], 36) // data
	putLE32(header, 40, dataSize)
	const out = new Uint8Array(44 + dataSize)
	out.set(header, 0)
	out.set(pcm, 44)
	return out
}

/**
 * 拼接多个 Uint8Array。
 * @param {Uint8Array[]} parts 片段
 * @returns {Uint8Array} 合并结果
 */
export function concatUint8(parts) {
	let total = 0
	for (const part of parts) total += part.byteLength
	const out = new Uint8Array(total)
	let offset = 0
	for (const part of parts) {
		out.set(part, offset)
		offset += part.byteLength
	}
	return out
}

/**
 * 字节数组转 base64。
 * @param {Uint8Array} bytes 字节
 * @returns {string} base64
 */
export function bytesToBase64(bytes) {
	let binary = ''
	const chunk = 0x8000
	for (let offset = 0; offset < bytes.length; offset += chunk)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
	return btoa(binary)
}

/**
 * 16 kHz PCM 线性插值升到 24 kHz（OpenAI Realtime）。
 * @param {Uint8Array} pcm16le 输入
 * @returns {Uint8Array} 24k PCM
 */
export function upsamplePcm16kTo24k(pcm16le) {
	const samples = new Int16Array(pcm16le.buffer, pcm16le.byteOffset, pcm16le.byteLength / 2)
	const outLen = Math.floor(samples.length * 24000 / 16000)
	const out = new Int16Array(outLen)
	for (let outputSampleIndex = 0; outputSampleIndex < outLen; outputSampleIndex++) {
		const src = outputSampleIndex * 16000 / 24000
		const lowerSampleIndex = Math.floor(src)
		const upperSampleIndex = Math.min(lowerSampleIndex + 1, samples.length - 1)
		const frac = src - lowerSampleIndex
		out[outputSampleIndex] = (samples[lowerSampleIndex] * (1 - frac) + samples[upperSampleIndex] * frac) | 0
	}
	return new Uint8Array(out.buffer)
}

/**
 * 降低 16 位小端 PCM 音量，避免削波。
 * @param {Uint8Array} pcm 输入
 * @returns {Uint8Array} 衰减后
 */
export function attenuatePcm16(pcm) {
	if (pcm.byteLength < 2) return pcm
	const out = new Uint8Array(pcm.byteLength)
	for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
		let sample = (pcm[offset] | pcm[offset + 1] << 8) << 16 >> 16
		sample = (sample / ATTENUATION_DIVISOR) | 0
		out[offset] = sample & 0xff
		out[offset + 1] = (sample >> 8) & 0xff
	}
	return out
}
