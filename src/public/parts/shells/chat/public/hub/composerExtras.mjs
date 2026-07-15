/**
 * 【文件】public/hub/composerExtras.mjs
 * 【职责】Hub composer 额外控件（内容警告、敏感媒体）的读写与清空。
 * 【原理】直接操作 #hub-content-warning / #hub-sensitive-media DOM，发送后清空。
 */

/**
 * 读取当前内容警告文本（空字符串 = 无）。
 * @returns {string} 内容警告文本
 */
export function getContentWarning() {
	const el = document.getElementById('hub-content-warning')
	return el instanceof HTMLInputElement ? el.value.trim() : ''
}

/**
 * 读取当前敏感媒体标记。
 * @returns {boolean} 是否已勾选
 */
export function getSensitiveMedia() {
	const el = document.getElementById('hub-sensitive-media')
	return el instanceof HTMLInputElement ? el.checked : false
}

/**
 * 发送成功后清空 CW / sensitive 控件并隐藏 extras 区。
 * @returns {void}
 */
export function clearComposerExtras() {
	const cw = document.getElementById('hub-content-warning')
	if (cw instanceof HTMLInputElement) cw.value = ''
	const sm = document.getElementById('hub-sensitive-media')
	if (sm instanceof HTMLInputElement) sm.checked = false
}

/**
 * 有附件时显示 composer extras（CW/sensitive 控件）。
 * @param {boolean} visible 是否显示
 * @returns {void}
 */
export function setComposerExtrasVisible(visible) {
	const el = document.getElementById('hub-composer-extras')
	if (el) el.hidden = !visible
}
