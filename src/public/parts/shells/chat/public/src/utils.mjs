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
