import * as Sentry from 'https://esm.sh/@sentry/browser'

import { showToastI18n } from '../../../../../scripts/toast.mjs'

/**
 * 处理时间戳以用作ID。
 * @param {string} time_stamp - 时间戳。
 * @returns {string} - 处理后的ID。
 */
export function processTimeStampForId(time_stamp) {
	return time_stamp?.replaceAll?.(/[\s./:]/g, '_')
}

/**
 * 将ArrayBuffer转换为Base64。
 * @param {ArrayBuffer} buffer - ArrayBuffer。
 * @returns {string} - Base64字符串。
 */
export function arrayBufferToBase64(buffer) {
	let binary = ''
	const bytes = new Uint8Array(buffer)
	for (let i = 0; i < bytes.byteLength; i++)
		binary += String.fromCharCode(bytes[i])
	return window.btoa(binary)
}

/**
 * 判断字节序列是否以给定前缀开头。
 * @param {Uint8Array} bytes - 待检测的字节。
 * @param {readonly number[]} prefix - 期望的前缀字节序列。
 * @returns {boolean} - 是否匹配前缀。
 */
function bytesStartWith(bytes, prefix) {
	if (bytes.length < prefix.length) return false
	for (let i = 0; i < prefix.length; i++)
		if (bytes[i] !== prefix[i]) return false
	return true
}

/**
 * 是否为 RIFF 容器且内嵌 WEBP（常见 WebP）。
 * @param {Uint8Array} bytes - 至少前 12 字节。
 * @returns {boolean} - 是否为 WebP 文件头。
 */
function isWebpRiff(bytes) {
	return bytes.length >= 12
		&& bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46])
		&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

/**
 * 根据文件头推测常见图片 MIME（用于修正剪贴板/浏览器给出的 application/octet-stream）。
 * @param {Uint8Array} bytes - 至少前 12 字节。
 * @returns {{ mime: string, ext: string } | null} - 推测的 MIME 与扩展名；无法识别时返回 null。
 */
export function sniffMimeFromMagicBytes(bytes) {
	if (!bytes?.length) return null
	if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { mime: 'image/png', ext: 'png' }
	if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' }
	if (bytesStartWith(bytes, [0x47, 0x49, 0x46])) return { mime: 'image/gif', ext: 'gif' }
	if (isWebpRiff(bytes)) return { mime: 'image/webp', ext: 'webp' }
	return null
}

/**
 * 滑动阈值。
 * @type {number}
 */
export const SWIPE_THRESHOLD = 50
/**
 * 过渡持续时间。
 * @type {number}
 */
export const TRANSITION_DURATION = 500
/**
 * 默认头像。
 * @type {string}
 */
export const DEFAULT_AVATAR = 'https://api.iconify.design/line-md/person.svg'

/**
 * 将未知异常值归一化为 Error 实例。
 * @param {unknown} error 捕获到的错误值
 * @returns {Error} 归一化后的 Error 实例
 */
export function normalizeError(error) {
	return error instanceof Error ? error : new Error(String(error))
}

/**
 * @param {unknown} error 捕获到的错误值
 * @param {string} toastKey i18n key，传给 showToastI18n 的第二个参数
 * @param {string} [logPrefix] console.error 前缀
 * @param {Record<string, unknown>} [toastParams] 传给 showToastI18n 的 i18n 插值参数（可选）
 */
export function handleUIError(error, toastKey, logPrefix, toastParams) {
	if (logPrefix) console.error(logPrefix, error)
	else console.error(error)
	const hasToastParams = toastParams != null && typeof toastParams === 'object' && Object.keys(toastParams).length > 0
	if (hasToastParams) showToastI18n('error', toastKey, toastParams)
	else showToastI18n('error', toastKey)
	try {
		if (typeof Sentry !== 'undefined' && Sentry?.captureException)
			Sentry.captureException(error)
	}
	catch (e) {
		console.error('Sentry.captureException failed:', e)
	}
}
