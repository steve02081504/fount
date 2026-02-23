import { ClipboardAddon } from 'https://esm.sh/@xterm/addon-clipboard'
import { FitAddon } from 'https://esm.sh/@xterm/addon-fit'
import { WebLinksAddon } from 'https://esm.sh/@xterm/addon-web-links'
import chroma from 'https://esm.sh/chroma-js'
import { Terminal } from 'https://esm.sh/xterm'

import { onThemeChange } from './theme.mjs'

/**
 * 设置终端。
 * @param {HTMLElement} element - 终端元素。
 * @returns {Terminal} - 终端实例。
 */
export function setTerminal(element) {
	const terminal = new Terminal({
		linkHandler: {
			/**
			 * 激活链接。
			 * @param {MouseEvent} event - 鼠标事件。
			 * @param {string} text - 链接文本。
			 * @param {object} range - 范围。
			 * @returns {void}
			 */
			activate(event, text, range) {
				// 如果右键点击,则不打开链接
				if (event.button === 2) return
				event.preventDefault()
				window.open(text, '_blank')
			}
		},
		cursorBlink: true
	})

	const fitAddon = new FitAddon()
	terminal.loadAddon(fitAddon)
	terminal.loadAddon(new WebLinksAddon())
	terminal.loadAddon(new ClipboardAddon())

	onThemeChange((theme, is_dark) => {
		const rootStyle = getComputedStyle(document.documentElement)

		const terminalColorMap = {
			cursor: '--color-base-300',
			background: '--color-neutral',
			foreground: '--color-neutral-content',
			selectionBackground: '--color-primary-content',
			selectionForeground: '--color-primary',
			selectionInactiveBackground: '--color-neutral-content',
		}

		const terminalOptions = { ...terminal.options.theme }

		for (const option in terminalColorMap) {
			const cssVariable = terminalColorMap[option]
			const colorValue = rootStyle.getPropertyValue(cssVariable).trim()
			terminalOptions[option] = chroma(colorValue).hex()
		}

		terminal.options.theme = terminalOptions
	})
	terminal.open(element)
	fitAddon.fit()
	window.addEventListener('resize', () => {
		fitAddon.fit()
	})
	terminal.element.addEventListener('contextmenu', async event => {
		event.preventDefault()
		const selectedText = terminal.getSelection()
		if (selectedText) {
			await navigator.clipboard.writeText(selectedText)
			terminal.clearSelection()
		}
		else
			terminal.paste(await navigator.clipboard.readText())
	})
	return terminal
}
