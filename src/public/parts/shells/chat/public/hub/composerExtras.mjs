/**
 * 【文件】public/hub/composerExtras.mjs
 * 【职责】Hub composer 额外控件（内容警告、敏感媒体）的读写与清空。
 * 【原理】委托 shared/composerAttachmentFields；发送后清空并清引用目标。
 * 【关联】composerFiles / composerDraft / composerEvents 经 `onFilesChange` 传入本模块的 `setComposerExtrasVisible`（truthy 即显示，可直接传附件数）。
 */
import {
	clearCwSensitive,
	readCwSensitive,
} from '../shared/composerAttachmentFields.mjs'

const HUB_CW_IDS = { cwId: 'content-warning', sensitiveId: 'sensitive-media' }

/**
 * 读取当前内容警告文本（空字符串 = 无）。
 * @returns {string} 内容警告文本
 */
export function getContentWarning() {
	return readCwSensitive(HUB_CW_IDS).contentWarning
}

/**
 * 读取当前敏感媒体标记。
 * @returns {boolean} 是否已勾选
 */
export function getSensitiveMedia() {
	return readCwSensitive(HUB_CW_IDS).sensitiveChecked
}

/**
 * 发送成功后清空 CW / sensitive 控件并隐藏 extras 区（含引用目标）。
 * @returns {void}
 */
export function clearComposerExtras() {
	clearCwSensitive(HUB_CW_IDS)
	void import('./composerReply.mjs').then(({ clearReplyTarget }) => clearReplyTarget())
}

/**
 * 显隐 composer extras（CW/sensitive）。可传 boolean 或附件数量（truthy = 显示）。
 * @param {boolean | number} visible 是否显示 / 附件数
 * @returns {void}
 */
export function setComposerExtrasVisible(visible) {
	const el = document.getElementById('composer-extras')
	el.hidden = !visible
	el.classList.toggle('hidden', !visible)
}
