/**
 * 浏览器页：套 fount 主题，把 DOM 终端接到 icon session。
 */
import { setTerminal } from '../../src/public/pages/scripts/components/terminal.mjs'
import { applyTheme } from '../../src/public/pages/scripts/theme/index.mjs'

import { setIO } from './session.mjs'

applyTheme()

/**
 * 在容器上挂终端并绑定 icon IO。
 * @param {HTMLElement} [element] 终端容器，默认 `#term`
 * @returns {import('https://esm.sh/xterm').Terminal} 终端
 */
export function attach(element = document.getElementById('term')) {
	const terminal = setTerminal(element)
	setIO(terminal)
	return terminal
}
