import { geti18n, offLanguageChange, onLanguageChange } from './i18n.mjs'
import { onElementRemoved } from './onElementRemoved.mjs'
import { showToast } from './toast.mjs'

const capPromise = new Promise((resolve, reject) => {
	if (window.Cap) return resolve()

	// Inject the main widget script
	const widgetScript = document.createElement('script')
	widgetScript.src = 'https://cdn.jsdelivr.net/npm/@cap.js/widget'
	widgetScript.addEventListener('load', resolve)
	widgetScript.addEventListener('error', reject)
	document.head.appendChild(widgetScript)

	// Inject styles for theme adaptation
	const style = document.createElement('style')
	style.textContent = `\
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
	document.head.appendChild(style)
})

/**
 * Creates and manages a POW (Proof-of-Work) CAPTCHA widget.
 * @param {HTMLElement} container The DOM element to append the widget to.
 * @returns {Promise<import('https://cdn.jsdelivr.net/gh/tiagozip/cap/widget/src/cap.d.ts').Cap>} An object to interact with the CAPTCHA.
 */
export async function createPOWCaptcha(container) {
	await capPromise

	const widget = document.createElement('cap-widget')

	// Apply translations
	const updateI18n = () => {
		widget.setAttribute('data-cap-i18n-verifying-label', geti18n('pow_captcha.verifying'))
		widget.setAttribute('data-cap-i18n-initial-state', geti18n('pow_captcha.initial'))
		widget.setAttribute('data-cap-i18n-solved-label', geti18n('pow_captcha.solved'))
		widget.setAttribute('data-cap-i18n-error-label', geti18n('pow_captcha.error'))
		widget.setAttribute('data-cap-i18n-wasm-disabled', geti18n('pow_captcha.wasm_disabled'))
	}

	updateI18n()
	onLanguageChange(updateI18n)

	// Clear container and append widget
	container.replaceChildren(widget)

	const cap = new window.Cap({ apiEndpoint: '/api/pow/' }, widget)

	// Register cleanup logic for when the element is removed
	onElementRemoved(widget, () => offLanguageChange(updateI18n))

	// Event listeners for promise resolution
	widget.addEventListener('error', (e) => {
		console.error('POW CAPTCHA Error:', e.detail)
		showToast(geti18n('pow_captcha.error') + `: ${e.detail.message}`, 'error')
	})

	return cap
}
