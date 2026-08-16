/**
 * 浏览器页：套 fount 主题，把 DOM 终端接到 icon session。
 */
import { setTerminal } from '../../src/public/pages/scripts/components/terminal.mjs'

import * as icon from './session.mjs'

/**
 * 在容器上挂终端并绑定 icon IO，同时把 `terminal` / `icon` 挂到 `globalThis`。
 * @param {HTMLElement} [element] 终端容器，默认 `#terminal`
 * @returns {import('https://esm.sh/xterm').Terminal} 终端
 */
export function attach(element = document.getElementById('terminal')) {
	const terminal = setTerminal(element)
	icon.setIO(terminal)
	Object.assign(globalThis, { terminal, icon })
	return terminal
}
