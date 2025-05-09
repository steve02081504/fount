import { applyTheme, onThemeChange } from '../../scripts/theme.mjs'
applyTheme()

import { Terminal } from 'https://esm.run/xterm'
import { WebLinksAddon } from 'https://esm.run/@xterm/addon-web-links'
import { ClipboardAddon } from 'https://esm.run/@xterm/addon-clipboard'
import { FitAddon } from 'https://esm.run/@xterm/addon-fit'
import chroma from 'https://esm.run/chroma-js'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'

const terminal = new Terminal({
	linkHandler: {
		activate(event, text, range) {
			// 如果右键点击,则不打开链接
			if (event.button === 2) return
			event.preventDefault()
			window.open(text, '_blank')
		}
	},
	cursorBlink: true
})

const fiter = new FitAddon()
terminal.loadAddon(fiter)
terminal.loadAddon(new WebLinksAddon())
terminal.loadAddon(new ClipboardAddon())

terminal.open(document.getElementById('terminal'))
fiter.fit()
window.addEventListener('resize', () => {
	fiter.fit()
})
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
terminal.element.addEventListener('contextmenu', async (event) => {
	event.preventDefault()
	const selectedText = terminal.getSelection()
	if (selectedText) {
		await navigator.clipboard.writeText(selectedText)
		terminal.clearSelection()
	}
	else
		terminal.paste(await navigator.clipboard.readText())
})

await initTranslations('terminal_assistant')

terminal.writeln(geti18n('terminal_assistant.initialMessage'))
terminal.writeln(`\x1b]8;;https://github.com/steve02081504/fount-pwsh\x07${geti18n('terminal_assistant.initialMessageLink')}\x1b]8;;\x07`)
