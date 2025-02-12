import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()

import { Terminal } from 'https://esm.run/xterm'
import { WebLinksAddon } from 'https://esm.run/@xterm/addon-web-links'
import { ClipboardAddon } from 'https://esm.run/@xterm/addon-clipboard'

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

terminal.loadAddon(new WebLinksAddon())

terminal.loadAddon(new ClipboardAddon())
terminal.open(document.getElementById('terminal'))
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

terminal.writeln('Fount 支持将你喜欢的角色部署到你的终端中辅助你编码！')
terminal.writeln('\x1b]8;;https://github.com/steve02081504/fount-pwsh\x07点击这里了解更多信息\x1b]8;;\x07')
