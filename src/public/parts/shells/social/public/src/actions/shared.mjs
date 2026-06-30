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
