import { registerCssUpdater, setCssVariable } from '../../../../../scripts/cssValues.mjs'

import { queue } from './virtualQueue.mjs'

/**
 *
 */
export function setupCss() {
	registerCssUpdater(() => {
		// 记录div chat-header的宽
		const headerWidth = document.querySelector('.chat-header').offsetWidth
		setCssVariable('--chat-header-width', `${headerWidth}px`)
		// 根据队列中的人数判断是否隐藏角色名
		const uniqueNames = new Set(queue.map(e => e.name))
		document.body.classList.toggle('hide-char-names', uniqueNames.size <= 2)
	})
}
