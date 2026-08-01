import { showToastI18n } from '../features/toast.mjs'
import { geti18n, setLocalizeLogic } from '../i18n/index.mjs'

/**
 * 创建并管理一个 POW (Proof-of-Work) CAPTCHA 小部件。
 * @param {HTMLElement} container 要附加小部件的 DOM 元素。
 * @returns {Promise<import('https://cdn.jsdelivrnet/gh/tiagozip/cap/widget/src/cap.d.ts').Cap>} 一个用于与 CAPTCHA 交互的对象。
 */
export async function createPOWCaptcha(container) {
	const capLibLoaded = import('https://esm.sh/@cap.js/widget')
	const widget = document.createElement('cap-widget')

	// Apply translations
	setLocalizeLogic(widget, () => {
		widget.dataset.capI18nVerifyingLabel = geti18n('util.pow_captcha.verifying')
		widget.dataset.capI18nInitialState = geti18n('util.pow_captcha.initial')
		widget.dataset.capI18nSolvedLabel = geti18n('util.pow_captcha.solved')
		widget.dataset.capI18nErrorLabel = geti18n('util.pow_captcha.error')
		widget.dataset.capI18nWasmDisabled = geti18n('util.pow_captcha.wasm_disabled')
	})

	// Clear container and append widget
	container.replaceChildren(widget)

	await capLibLoaded
	const cap = new window.Cap({ apiEndpoint: '/api/pow/' }, widget)

	// Event listeners for promise resolution
	widget.addEventListener('error', (e) => {
		console.error('POW CAPTCHA Error:', e.detail)
		showToastI18n('error', 'util.pow_captcha.errorMessage', { error: `${e.detail.message}` })
	})

	return cap
}

// --- 全局样式注入 ---

{
	const style = document.createElement('style')
	style.textContent = /* css */ `\
cap-widget {
	--cap-background: var(--color-base-100);
	--cap-border-color: var(--color-base-300);
	--cap-border-radius: var(--radius-box, 1rem);
	--cap-color: var(--color-base-content);
	--cap-checkbox-border: 1px solid var(--color-info);
	--cap-checkbox-border-radius: var(--radius-field, 0.5rem);
	--cap-checkbox-background: var(--color-base-200);
	--cap-font: inherit;
	--cap-spinner-color: var(--color-primary);
	--cap-spinner-background-color: var(--color-secondary);
}
`
	document.head.prepend(style)
}
