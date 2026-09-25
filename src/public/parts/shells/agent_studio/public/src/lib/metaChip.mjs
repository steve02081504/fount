/**
 * 【文件】public/src/lib/metaChip.mjs — 元信息徽章
 * 【职责】构造 `.meta-chip` 小标签并把一组文本挂入容器。
 * 【原理】空文本自动跳过，供会话、生成与子代理元信息复用。
 * 【关联】views/conversation.mjs、lib/generationDialog.mjs。
 */

/**
 * 构造一个元信息标签。
 * @param {string} text 文本
 * @returns {HTMLSpanElement} 标签
 */
export function createMetaChip(text) {
	const chip = document.createElement('span')
	chip.className = 'meta-chip'
	chip.textContent = text
	return chip
}

/**
 * 把一组文本作为元信息标签挂入容器（空值跳过）。
 * @param {HTMLElement} container 容器
 * @param {string[]} texts 文本列表
 * @returns {void}
 */
export function appendMetaChips(container, texts) {
	for (const text of texts)
		if (text) container.appendChild(createMetaChip(text))
}
