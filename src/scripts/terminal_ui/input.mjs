/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param: off, jsdoc/require-param-description: off, jsdoc/require-param-type: off, jsdoc/require-returns: off */
/** 单字符 CSI（无参数或带修饰参数）→ 按键名；`1;5` 是 Ctrl+方向键的修饰参数。 */
const CSI_KEY = { Z: 'shift-tab', '1;5H': 'ctrl-home', '1;5F': 'ctrl-end', A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' }
/** 带 `~` / `u` 的 CSI 序列 → 按键名。 */
const CSI_TILDE_KEY = { '3~': 'delete', '5~': 'page-up', '6~': 'page-down', '13;2u': 'newline', '99;5u': 'ctrl-c', '13u': 'enter' }
// VT input decoder. Escape sequences and UTF-8 can span reads.
export class InputDecoder {
	#pending = ''
	#pasting = false
	#paste = ''
	#decoder = new TextDecoder()
	get needsEscapeTimeout() { return this.#pending === '\x1b' }
	flushEscape() {
		if (!this.needsEscapeTimeout) return []
		this.#pending = ''
		return [{ type: 'key', key: 'escape' }]
	}

	push(bytes) {
		this.#pending += typeof bytes === 'string' ? bytes : this.#decoder.decode(bytes, { stream: true })
		const events = []
		while (this.#pending) {
			if (this.#pasting) {
				const end = this.#pending.indexOf('\x1b[201~')
				if (end < 0) {
					const safe = Math.max(0, this.#pending.length - 5)
					this.#paste += this.#pending.slice(0, safe)
					this.#pending = this.#pending.slice(safe)
					break
				}
				this.#paste += this.#pending.slice(0, end)
				events.push({ type: 'paste', text: this.#paste.replace(/\r\n?/g, '\n').replaceAll('\x1b', '') })
				this.#pending = this.#pending.slice(end + 6)
				this.#paste = ''
				this.#pasting = false
				continue
			}
			if (this.#pending.startsWith('\x1b[200~')) {
				this.#pending = this.#pending.slice(6)
				this.#pasting = true
				continue
			}
			if (this.#pending[0] === '\x1b') {
				const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.#pending)
				if (mouse) {
					const button = Number(mouse[1])
					events.push({ type: 'mouse', x: Number(mouse[2]) - 1, y: Number(mouse[3]) - 1,
						button: button & 3, shift: !!(button & 4), motion: !!(button & 32),
						action: button & 64 ? button & 1 ? 'wheel-down' : 'wheel-up' : mouse[4] === 'm' ? 'release' : button & 32 ? 'move' : 'press' })
					this.#pending = this.#pending.slice(mouse[0].length)
					continue
				}
				const csi = /^\x1b\[([\d;]*)([A-Za-z~])/.exec(this.#pending)
				if (csi) {
					if (csi[1] === '' && (csi[2] === 'I' || csi[2] === 'O')) {
						events.push({ type: 'focus', focused: csi[2] === 'I' })
						this.#pending = this.#pending.slice(csi[0].length)
						continue
					}
					const key = CSI_KEY[`${csi[1]}${csi[2]}`] ?? CSI_KEY[csi[1] === '' ? csi[2] : ''] ?? CSI_TILDE_KEY[`${csi[1]}${csi[2]}`]
					if (key) events.push({ type: 'key', key })
					this.#pending = this.#pending.slice(csi[0].length)
					continue
				}
				if (/^\x1b(?:\[<[\d;]*|\[[\d;]*|\[200?|\[201?|$)$/.test(this.#pending)) break
				this.#pending = this.#pending.slice(1)
				events.push({ type: 'key', key: 'escape' })
				continue
			}
			const character = Array.from(this.#pending)[0]
			this.#pending = this.#pending.slice(character.length)
			const key = { '\r': 'enter', '\n': 'enter', '\x03': 'ctrl-c', '\x04': 'ctrl-d', '\x7f': 'backspace', '\x08': 'backspace', '\t': 'tab' }[character]
			if (key) events.push({ type: 'key', key })
			else if (character >= ' ') events.push({ type: 'text', text: character })
		}
		return events
	}
}
