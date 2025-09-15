import { registerCssUpdater, setCssVariable } from '../../../../../scripts/cssValues.mjs'

export function setupCss() {
	registerCssUpdater(() => {
		// 记录div chat-header的宽
		const headerWidth = document.querySelector('.chat-header').offsetWidth
		setCssVariable('--chat-header-width', `${headerWidth}px`)
	})
}
