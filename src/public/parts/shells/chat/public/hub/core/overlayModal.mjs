/**
 * 【文件】public/hub/core/overlayModal.mjs
 * 【职责】Hub 通用设置浮层（`#settings-modal`）的打开、正文更新、关闭与顶部通知条。
 * 【原理】`openOverlayModal` / `closeOverlayModal` 管理标题、副标题与 body HTML；供聊天设置、联邦设置等复用。
 * 【数据结构】模块级 `#settings-modal` 元素引用与打开时的标题/正文快照。
 * 【关联】chat、chatConfig、profileEdit 等设置面板调用方。
 */
const overlayModal = document.getElementById('settings-modal')

/**
 * @param {HTMLElement} el 标题或副标题元素
 * @param {string | undefined} text 纯文本
 * @param {string | undefined} i18nKey data-i18n 键
 * @param {Record<string, string>} [params] dataset 插值参数
 * @returns {void}
 */
function setOverlayHeading(el, text, i18nKey, params = {}) {
	if (!el) return
	if (i18nKey) {
		el.dataset.i18n = i18nKey
		for (const [k, v] of Object.entries(params))
			el.dataset[k] = v
		return
	}
	delete el.dataset.i18n
	for (const k of Object.keys(el.dataset))
		if (k !== 'i18n') delete el.dataset[k]
	el.textContent = text || ''
}

/**
 * 打开通用设置浮层并写入内容。
 * @param {object} options 模态框内容
 * @param {string} [options.title] 主标题（纯文本）
 * @param {string} [options.titleKey] 主标题 i18n 键
 * @param {string} [options.subtitle] 副标题（纯文本）
 * @param {string} [options.subtitleKey] 副标题 i18n 键
 * @param {Record<string, string>} [options.subtitleParams] 副标题插值
 * @param {string | Element | DocumentFragment} [options.body] 主体内容
 * @param {string | Element | DocumentFragment} [options.footer] 底部操作区内容
 * @returns {void}
 */
export function openOverlayModal({
	title,
	titleKey,
	subtitle,
	subtitleKey,
	subtitleParams,
	body,
	footer,
}) {
	setOverlayHeading(
		document.getElementById('overlay-title'),
		title,
		titleKey || (title ? undefined : 'chat.hub.settingsModalTitle'),
	)
	setOverlayHeading(
		document.getElementById('overlay-subtitle'),
		subtitle || '',
		subtitleKey,
		subtitleParams,
	)
	setOverlayContent(document.getElementById('overlay-body'), body)
	setOverlayContent(document.getElementById('overlay-footer'), footer)
	if (!overlayModal.open) overlayModal.showModal()
}

/**
 * @param {HTMLElement | null} host 浮层内容容器
 * @param {string | Element | DocumentFragment | undefined} content 内容
 * @returns {void}
 */
function setOverlayContent(host, content) {
	if (!host) return
	host.replaceChildren()
	if (!content) return
	if (!content?.nodeType) {
		host.innerHTML = content
		return
	}
	if (content.nodeType === Node.DOCUMENT_FRAGMENT_NODE)
		host.append(...content.childNodes)
	else
		host.append(content)
}

/**
 * 更新浮层主体 HTML。
 * @param {string} html 新 HTML 内容
 * @returns {void}
 */
export function updateOverlayModalBody(html) {
	document.getElementById('overlay-body').innerHTML = html
}

/**
 * 关闭通用设置浮层并清空正文，避免下次打开前残留旧壳。
 * @returns {void}
 */
export function closeOverlayModal() {
	try { overlayModal.close() } catch { /* already closed */ }
	document.getElementById('overlay-body')?.replaceChildren()
	document.getElementById('overlay-footer')?.replaceChildren()
}

/**
 * 在浮层主体顶部展示提示信息。
 * @param {'error'|'success'} type 提示类型
 * @param {string} [text] 展示文本（`i18nKey` 未设时使用）
 * @param {string} [i18nKey] `data-i18n` 键
 * @returns {void}
 */
export function showOverlayNotice(type, text, i18nKey) {
	const body = document.getElementById('overlay-body')
	const cls = type === 'error' ? 'overlay-error alert alert-error' : 'overlay-success alert alert-success'
	const keyClass = type === 'error' ? 'overlay-error' : 'overlay-success'
	let host = body.querySelector(`.${keyClass}`)
	if (!host) {
		host = document.createElement('div')
		host.className = cls
		body.prepend(host)
	}
	if (i18nKey) {
		host.dataset.i18n = i18nKey
		for (const k of Object.keys(host.dataset))
			if (k !== 'i18n') delete host.dataset[k]
	}
	else {
		delete host.dataset.i18n
		host.textContent = text || ''
	}
	host.style.display = 'block'
	if (type === 'success')
		setTimeout(() => { host.style.display = 'none' }, 2500)
}
