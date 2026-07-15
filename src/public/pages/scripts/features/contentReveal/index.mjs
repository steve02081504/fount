import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

const CSS_HREF = '/scripts/features/contentReveal/contentReveal.css'

/**
 * 确保 content reveal 样式表已注入。
 * @returns {void}
 */
function ensureContentRevealStyles() {
	if (document.querySelector('link[data-content-reveal-css]')) return
	document.head.appendChild(Object.assign(document.createElement('link'), {
		rel: 'stylesheet',
		href: CSS_HREF,
		dataset: { contentRevealCss: '' },
	}))
}

/**
 * 为敏感媒体内容包裹遮罩层 HTML。
 * @param {string} innerHtml 内层媒体 HTML
 * @param {{ warningLabel?: string, revealLabel?: string }} [options] 标签文案
 * @returns {string} 包裹后的 HTML
 */
export function wrapSensitiveMediaHtml(innerHtml, { warningLabel = '', revealLabel = 'Reveal' } = {}) {
	ensureContentRevealStyles()
	const label = escapeHtml(warningLabel)
	const reveal = escapeHtml(revealLabel)
	return `<div class="sensitive-media-wrap" data-sensitive-collapsed="1">
		<div class="sensitive-media-overlay">
			<div class="sensitive-media-label">${label}</div>
			<button type="button" class="sensitive-media-reveal">${reveal}</button>
		</div>
		<div class="sensitive-media-body">${innerHtml}</div>
	</div>`
}

/**
 * 为正文包裹内容警告（CW）折叠层 HTML。
 * @param {string} innerHtml 内层正文 HTML
 * @param {{ warningLabel?: string, revealLabel?: string }} [options] 标签文案
 * @returns {string} 包裹后的 HTML
 */
export function wrapContentWarningHtml(innerHtml, { warningLabel = '', revealLabel = 'Reveal' } = {}) {
	ensureContentRevealStyles()
	const label = escapeHtml(warningLabel)
	const reveal = escapeHtml(revealLabel)
	return `<div class="content-warning-wrap" data-cw-collapsed="1">
		<div class="content-warning-label">${label}</div>
		<button type="button" class="content-warning-reveal">${reveal}</button>
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
