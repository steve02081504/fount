import { VirtualConsole } from 'https://esm.sh/@steve02081504/virtual-console'
import { ClipboardAddon } from 'https://esm.sh/@xterm/addon-clipboard'
import { FitAddon } from 'https://esm.sh/@xterm/addon-fit'
import { WebLinksAddon } from 'https://esm.sh/@xterm/addon-web-links'
import chroma from 'https://esm.sh/chroma-js'
import { Terminal } from 'https://esm.sh/xterm'

import { onThemeChange } from '../theme/index.mjs'

document.head.prepend(Object.assign(document.createElement('link'), {
	rel: 'stylesheet',
	href: 'https://cdn.jsdelivr.net/npm/xterm/css/xterm.min.css',
}))

/**
 * 简易事件订阅。
 * @returns {{ on: (event: string, fn: Function) => void, off: (event: string, fn: Function) => void, emit: (event: string, ...args: unknown[]) => void }} 事件口
 */
const createEmitter = () => {
	const listeners = new Map()
	return {
		/**
		 * @param {string} event 事件名
		 * @param {Function} fn 回调
		 * @returns {void}
		 */
		on(event, fn) {
			let set = listeners.get(event)
			if (!set) listeners.set(event, set = new Set())
			set.add(fn)
		},
		/**
		 * @param {string} event 事件名
		 * @param {Function} fn 回调
		 * @returns {void}
		 */
		off(event, fn) {
			listeners.get(event)?.delete(fn)
		},
		/**
		 * @param {string} event 事件名
		 * @param {...unknown} args 参数
		 * @returns {void}
		 */
		emit(event, ...args) {
			for (const fn of listeners.get(event) ?? []) fn(...args)
		},
	}
}

/**
 * 将写入值规范为文本。
 * @param {unknown} chunk 写入块
 * @returns {string} 文本
 */
const chunkToText = (chunk) => {
	if (typeof chunk === 'string') return chunk
	if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk)
	if (chunk == null) return ''
	return String(chunk)
}

/**
 * 设置终端。
 * @param {HTMLElement} element - 终端元素。
 * @returns {Terminal} - 终端实例（附 `console` / `stdin` / `stdout` / `stderr`）。
 */
export function setTerminal(element) {
	const terminal = new Terminal({
		convertEol: true,
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

	onThemeChange(() => {
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
			if (!colorValue) continue
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

	const vc = new VirtualConsole()
	const outEvents = createEmitter()
	const inEvents = createEmitter()

	/**
	 * @param {unknown} chunk 写入块
	 * @returns {boolean} 是否写入
	 */
	const paint = (chunk) => {
		terminal.write(chunkToText(chunk))
		return true
	}

	const targetStream = {
		/**
		 * @param {unknown} chunk 写入块
		 * @returns {boolean} 是否写入
		 */
		write: paint,
	}

	/**
	 * @param {'stdout' | 'stderr'} method 流方法名
	 * @returns {object} 虚拟流
	 */
	const createStdStream = (method) => ({
		isTTY: true,
		writable: true,
		targetStream,
		/**
		 * @returns {number} 列数
		 */
		get columns() { return terminal.cols },
		/**
		 * @returns {number} 行数
		 */
		get rows() { return terminal.rows },
		/**
		 * @param {unknown} chunk 写入块
		 * @returns {boolean} 是否写入
		 */
		write(chunk) {
			const text = chunkToText(chunk)
			vc.writeAs(method, text)
			return paint(text)
		},
		on: outEvents.on,
		off: outEvents.off,
	})

	const stdout = createStdStream('stdout')
	const stderr = createStdStream('stderr')
	const ioConsole = Object.create(vc)
	Object.defineProperty(ioConsole, '_stdout', { value: stdout, enumerable: true })
	Object.defineProperty(ioConsole, '_stderr', { value: stderr, enumerable: true })

	vc.addLogEntryListener(entry => {
		if (entry.method === 'stdout' || entry.method === 'stderr') return
		paint(entry.toString())
	})

	const stdin = {
		isTTY: true,
		/**
		 * @param {boolean} [_mode] raw 模式（DOM 无操作）
		 * @returns {void}
		 */
		setRawMode(_mode) { /* xterm 已是字符模式 */ },
		/**
		 * @returns {void}
		 */
		resume() { /* xterm 持续投递 onData */ },
		/**
		 * @returns {void}
		 */
		pause() { /* 不停 xterm；player 会 off('data') */ },
		on: inEvents.on,
		off: inEvents.off,
	}

	terminal.onData(data => {
		inEvents.emit('data', Uint8Array.from(data, char => char.charCodeAt(0) & 0xff))
	})
	terminal.onResize(() => {
		outEvents.emit('resize')
	})

	terminal.console = ioConsole
	terminal.stdin = stdin
	terminal.stdout = stdout
	terminal.stderr = stderr
	return terminal
}
