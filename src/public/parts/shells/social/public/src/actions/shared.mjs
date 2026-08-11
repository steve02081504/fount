import { formatSocialShareHttpsUrl } from '../../shared/protocolUrl.mjs'
import { state } from '../state.mjs'

/**
 * 关闭所有帖子溢出菜单（可选排除某一容器）。
 * @param {HTMLElement | null} [exceptContainer] 保留打开的容器
 * @returns {void}
 */
export function closePostMoreMenus(exceptContainer = null) {
	for (const details of document.querySelectorAll('.post-more-dropdown'))
		if (details !== exceptContainer && /** @type {HTMLDetailsElement} */ details.open)
			/** @type {HTMLDetailsElement} */ details.open = false
}

/**
 * 将文本复制到系统剪贴板（含降级方案）。
 * @param {string} link 文本
 * @returns {Promise<void>}
 */
export async function copyTextToClipboard(link) {
	try {
		await navigator.clipboard.writeText(link)
	}
	catch {
		const input = document.createElement('textarea')
		input.value = link
		document.body.appendChild(input)
		input.select()
		document.execCommand('copy')
		input.remove()
	}
}

/**
 * 系统分享帖子链接；不支持则复制到剪贴板。
 * @param {string} entityHash 作者
 * @param {string} postId 帖子
 * @param {string} [title] 分享标题
 * @returns {Promise<'shared' | 'copied'>} 结果
 */
export async function shareOrCopyPostLink(entityHash, postId, title) {
	const url = formatSocialShareHttpsUrl(entityHash, postId, state.viewerNodeHash || undefined)
	if (navigator.share)
		try {
			await navigator.share({ title: title || 'fount', url })
			return 'shared'
		}
		catch (err) {
			if (err?.name === 'AbortError') return 'shared'
		}

	await copyTextToClipboard(url)
	return 'copied'
}

/** @type {WeakMap<HTMLElement, string>} */
const flashCopiedOriginalKeys = new WeakMap()
/** @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>>} */
const flashCopiedTimers = new WeakMap()

/**
 * 短暂把标签文案切成「已复制」再还原（依赖 data-i18n）。
 * @param {HTMLElement | null | undefined} label 文案节点
 * @param {string} [restoreKey] 还原用 i18n 键；缺省取当前 data-i18n
 * @returns {void}
 */
export function flashCopiedLabel(label, restoreKey) {
	if (!(label instanceof HTMLElement)) return
	const candidate = restoreKey || label.dataset.i18n
	if (candidate && candidate !== 'social.actions.copied')
		flashCopiedOriginalKeys.set(label, candidate)
	const restore = flashCopiedOriginalKeys.get(label)
	if (!restore) return
	const prev = flashCopiedTimers.get(label)
	if (prev) clearTimeout(prev)
	label.dataset.i18n = 'social.actions.copied'
	flashCopiedTimers.set(label, setTimeout(() => {
		label.dataset.i18n = restore
		flashCopiedOriginalKeys.delete(label)
		flashCopiedTimers.delete(label)
	}, 1500))
}
