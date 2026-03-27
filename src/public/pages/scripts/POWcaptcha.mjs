import { geti18n, setLocalizeLogic } from './i18n.mjs'
import { showToastI18n } from './toast.mjs'

/**
 * 注入主题适应的样式。
 */
let styleElement

/**
 * 创建并管理一个 POW (Proof-of-Work) CAPTCHA 小部件。
 * @param {HTMLElement} container 要附加小部件的 DOM 元素。
 * @returns {Promise<import('https://cdn.jsdelivrnet/gh/tiagozip/cap/widget/src/cap.d.ts').Cap>} 一个用于与 CAPTCHA 交互的对象。
 */
export async function createPOWCaptcha(container) {
	const capLibLoaded = import('https://esm.sh/@cap.js/widget')
	styleElement ??= document.head.appendChild(Object.assign(document.createElement('style'), {
		textContent: /* css */ `\
cap-widget {
	--cap-background: oklch(var(--b1));
	--cap-border-color: oklch(var(--b3));
	--cap-border-radius: var(--rounded-box, 1rem);
	--cap-color: oklch(var(--bc));
	--cap-checkbox-border: 1px solid oklch(var(--in));
	--cap-checkbox-border-radius: var(--rounded-btn, 0.5rem);
	--cap-checkbox-background: oklch(var(--b2));
	--cap-font: inherit;
	--cap-spinner-color: oklch(var(--p));
	--cap-spinner-background-color: oklch(var(--s));
}
`
	}))

	const widget = document.createElement('cap-widget')

	// Apply translations
	setLocalizeLogic(widget, () => {
		widget.dataset.capI18nVerifyingLabel = geti18n('pow_captcha.verifying')
		widget.dataset.capI18nInitialState = geti18n('pow_captcha.initial')
		widget.dataset.capI18nSolvedLabel = geti18n('pow_captcha.solved')
		widget.dataset.capI18nErrorLabel = geti18n('pow_captcha.error')
		widget.dataset.capI18nWasmDisabled = geti18n('pow_captcha.wasm_disabled')
	})

	// Clear container and append widget
	container.replaceChildren(widget)

	await capLibLoaded
	const cap = new window.Cap({ apiEndpoint: '/api/pow/' }, widget)

	// Event listeners for promise resolution
	widget.addEventListener('error', (e) => {
		console.error('POW CAPTCHA Error:', e.detail)
		showToastI18n('error', 'pow_captcha.errorMessage', { error: `${e.detail.message}` })
	})

	return cap
}
