/**
 * 标题锚点：为 Markdown 标题生成 GitHub 风格 slug id、追加可点击的锚点链接，
 * 并支持在异步渲染完成后依 URL hash 滚动到对应标题。供 blog 文章页与 gist 查看页共用。
 */

/**
 * 为标题生成 GitHub 风格锚点 id（保留 CJK，标点去除，空白转连字符），保证在 used 内唯一。
 * @param {string} text 标题文本
 * @param {Set<string>} used 已占用的 id 集合（会被就地更新）
 * @returns {string} 唯一锚点 id
 */
export function headingSlug(text, used) {
	const base = String(text ?? '').trim().toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '') || 'section'
	let slug = base
	for (let i = 1; used.has(slug); i++) slug = `${base}-${i}`
	used.add(slug)
	return slug
}

/**
 * 为根节点内的标题补锚点 id，并在标题末尾追加一个空文本的锚点链接；
 * 点击该链接由浏览器原生导航更新 URL hash。重复调用不会重复追加。
 * @param {ParentNode} root 渲染后的内容根节点
 * @param {{ selector?: string, anchorClassName?: string }} [options] 标题选择器与锚点类名
 * @returns {HTMLElement[]} 处理过的标题元素
 */
export function decorateHeadings(root, { selector = 'h1, h2, h3, h4, h5, h6', anchorClassName = 'heading-anchor' } = {}) {
	const headings = [...root.querySelectorAll(selector)]
	const used = new Set([...root.querySelectorAll('[id]')].map(element => element.id))
	for (const heading of headings) {
		if (!heading.id) heading.id = headingSlug(heading.textContent, used)
		if (heading.querySelector(`:scope > .${anchorClassName}`)) continue
		const anchor = document.createElement('a')
		anchor.className = anchorClassName
		anchor.href = `#${heading.id}`
		anchor.setAttribute('aria-hidden', 'true')
		anchor.tabIndex = -1
		heading.appendChild(anchor)
	}
	return headings
}

/**
 * 解析当前 URL hash 并滚动到对应元素（异步渲染完成后调用；无匹配时不动）。
 * @param {ParentNode} root 在其中查找目标 id 的根节点
 * @returns {boolean} 是否找到并滚动
 */
export function scrollToHash(root) {
	const raw = location.hash.slice(1)
	if (!raw) return false
	let id = raw
	try {
		id = decodeURIComponent(raw)
	}
	catch {
		id = raw
	}
	const target = document.getElementById(id)
	if (!target || !root.contains(target)) return false
	target.scrollIntoView({ block: 'start' })
	return true
}

/**
 * 监听 hashchange，在 hash 变化时滚动到对应元素。
 * @param {ParentNode} root 在其中查找目标 id 的根节点
 * @returns {() => void} 解除监听的函数
 */
export function watchHash(root) {
	/**
	 * hash 变化时滚动到新目标。
	 * @returns {void}
	 */
	const onHashChange = () => { scrollToHash(root) }
	window.addEventListener('hashchange', onHashChange)
	return () => window.removeEventListener('hashchange', onHashChange)
}
