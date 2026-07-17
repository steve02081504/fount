import { formatSocialShareHttpsUrl } from '../../shared/protocolUrl.mjs'
import { socialState } from '../state.mjs'

/**
 * 关闭所有帖子溢出菜单（可选排除某一菜单）。
 * @param {HTMLElement | null} [exceptMenu] 保留打开的菜单
 * @returns {void}
 */
export function closePostMoreMenus(exceptMenu = null) {
	for (const menu of document.querySelectorAll('.post-more-menu'))
		if (menu !== exceptMenu)
			menu.classList.add('hidden')
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
	const url = formatSocialShareHttpsUrl(entityHash, postId, socialState.viewerNodeHash || undefined)
	if (typeof navigator.share === 'function')
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
