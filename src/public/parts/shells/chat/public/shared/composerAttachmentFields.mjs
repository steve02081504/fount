/**
 * Composer 内容警告 / 敏感媒体 DOM 读写薄层（Chat Hub 与 Social 共用）。
 * 元素 ID 由调用方传入；不含 replyTo（两壳产品模型不同）。
 */
import { resolveSensitiveMedia } from './messageFields.mjs'

/**
 * @typedef {{ cwId: string, sensitiveId: string }} CwSensitiveIds
 */

/**
 * 读取 CW 文本与敏感媒体勾选，并推导最终 sensitive 标记。
 * @param {CwSensitiveIds} ids 元素 id
 * @returns {{ contentWarning: string, sensitiveChecked: boolean, sensitiveMedia: boolean }} 字段快照
 */
export function readCwSensitive({ cwId, sensitiveId }) {
	const cwEl = document.getElementById(cwId)
	const contentWarning = cwEl instanceof HTMLInputElement ? cwEl.value.trim() : ''
	const smEl = document.getElementById(sensitiveId)
	const sensitiveChecked = smEl instanceof HTMLInputElement ? smEl.checked : false
	return {
		contentWarning,
		sensitiveChecked,
		sensitiveMedia: applySensitiveDefault(sensitiveChecked, contentWarning),
	}
}

/**
 * 清空 CW / 敏感媒体控件（不改其它 composer 状态）。
 * @param {CwSensitiveIds} ids 元素 id
 * @returns {void}
 */
export function clearCwSensitive({ cwId, sensitiveId }) {
	const cw = document.getElementById(cwId)
	if (cw instanceof HTMLInputElement) cw.value = ''
	const sm = document.getElementById(sensitiveId)
	if (sm instanceof HTMLInputElement) sm.checked = false
}

/**
 * 勾选或内容警告任一成立则视为敏感媒体。
 * @param {boolean} checked 勾选态
 * @param {string} [contentWarning] CW 文本
 * @returns {boolean} 是否敏感
 */
export function applySensitiveDefault(checked, contentWarning) {
	return Boolean(checked) || Boolean(String(contentWarning || '').trim())
}

/**
 * 与后端 `resolveSensitiveMedia` 对齐的别名（显式 true/false 优先）。
 * @param {unknown} value 原始 sensitive 标记
 * @param {string} [contentWarning] CW
 * @returns {boolean} 是否敏感
 */
export function resolveComposerSensitive(value, contentWarning) {
	return resolveSensitiveMedia(value, contentWarning)
}
