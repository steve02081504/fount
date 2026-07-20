import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

const CSS_HREF = '/scripts/features/contentReveal/contentReveal.css'

/**
 * 确保 content reveal 样式表已注入。
 * @returns {void}
 */
function ensureContentRevealStyles() {
	if (document.querySelector('link[data-content-reveal-css]')) return
	const link = document.createElement('link')
	link.rel = 'stylesheet'
	link.href = CSS_HREF
	link.dataset.contentRevealCss = ''
	document.head.appendChild(link)
}

/**
 * 为敏感媒体内容包裹遮罩层 HTML。
 * @param {string} innerHtml 内层媒体 HTML
 * @param {{ warningLabel?: string, revealLabel?: string, warningI18n?: string, revealI18n?: string }} [options] 标签文案（优先 *I18n → data-i18n）
 * @returns {string} 包裹后的 HTML
 */
export function wrapSensitiveMediaHtml(innerHtml, { warningLabel = '', revealLabel = 'Reveal', warningI18n, revealI18n } = {}) {
	ensureContentRevealStyles()
	const label = warningI18n
		? `<div class="sensitive-media-label" data-i18n="${escapeHtml(warningI18n)}"></div>`
		: `<div class="sensitive-media-label">${escapeHtml(warningLabel)}</div>`
	const reveal = revealI18n
		? `<button type="button" class="sensitive-media-reveal" data-i18n="${escapeHtml(revealI18n)}"></button>`
		: `<button type="button" class="sensitive-media-reveal">${escapeHtml(revealLabel)}</button>`
	return `<div class="sensitive-media-wrap" data-sensitive-collapsed="1">
		<div class="sensitive-media-overlay">
			${label}
			${reveal}
		</div>
		<div class="sensitive-media-body">${innerHtml}</div>
	</div>`
}

/**
 * 为正文包裹内容警告（CW）折叠层 HTML。
 * @param {string} innerHtml 内层正文 HTML
 * @param {{ warningLabel?: string, revealLabel?: string, revealI18n?: string }} [options] 标签文案（revealI18n → data-i18n）
 * @returns {string} 包裹后的 HTML
 */
export function wrapContentWarningHtml(innerHtml, { warningLabel = '', revealLabel = 'Reveal', revealI18n } = {}) {
	ensureContentRevealStyles()
	const label = escapeHtml(warningLabel)
	const reveal = revealI18n
		? `<button type="button" class="content-warning-reveal" data-i18n="${escapeHtml(revealI18n)}"></button>`
		: `<button type="button" class="content-warning-reveal">${escapeHtml(revealLabel)}</button>`
	return `<div class="content-warning-wrap" data-cw-collapsed="1">
		<div class="content-warning-label">${label}</div>
		${reveal}
		<div class="content-warning-body hidden">${innerHtml}</div>
	</div>`
}

/**
 * 在根节点上委托绑定 CW 与敏感媒体的 reveal 点击（幂等）。
 * @param {HTMLElement} root 事件委托根
 * @returns {void}
 */
export function bindContentReveal(root) {
	if (!(root instanceof HTMLElement) || root.dataset.contentRevealBound === '1') return
	root.dataset.contentRevealBound = '1'
	ensureContentRevealStyles()
	root.addEventListener('click', event => {
		const { target } = event
		if (!(target instanceof HTMLElement)) return

		const reveal = target.closest('.content-warning-reveal')
		if (reveal instanceof HTMLElement) {
			const wrap = reveal.closest('.content-warning-wrap')
			const body = wrap?.querySelector('.content-warning-body')
			if (body) {
				body.classList.remove('hidden')
				reveal.remove()
			}
			return
		}

		const sensitiveReveal = target.closest('.sensitive-media-reveal')
		if (sensitiveReveal instanceof HTMLElement) {
			const wrap = sensitiveReveal.closest('.sensitive-media-wrap')
			if (wrap instanceof HTMLElement) {
				wrap.dataset.sensitiveCollapsed = '0'
				wrap.classList.add('revealed')
				sensitiveReveal.closest('.sensitive-media-overlay')?.remove()
			}
		}
	})
}
