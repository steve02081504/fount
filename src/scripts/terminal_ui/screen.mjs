/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param: off, jsdoc/require-param-description: off, jsdoc/require-param-type: off, jsdoc/require-returns: off */
import { pad } from './text.mjs'

export class TerminalScreen {
	#rows = []
	#styles = []
	#entered = false
	#raw = false
	constructor({ stdin, stdout, mode = 'fullscreen' }) {
		this.stdin = stdin
		this.stdout = stdout
		this.mode = mode
	}
	enter() {
		if (this.#entered) return
		this.#entered = true
		this.#raw = !!this.stdin.isRaw
		if (this.stdin.setRawMode) this.stdin.setRawMode(true)
		this.stdin.resume()
		this.stdout.write(`${this.mode === 'fullscreen' ? '\x1b[?1049h' : ''}\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[>1u`)
	}
	paint(lines, cursor, styles = []) {
		const rows = Math.max(1, this.stdout.rows || 24)
		const cols = Math.max(1, this.stdout.columns || 80)
		let output = '\x1b[?25l'
		// 比较未上色的正文，样式变化才重画，逐行去重不被转义序列打断。
		for (let row = 0; row < rows; row++) {
			const text = pad(lines[row] ?? '', cols)
			if (text !== this.#rows[row] || styles[row] !== this.#styles[row])
				output += `\x1b[${row + 1};1H${styles[row] ? `\x1b[${styles[row]}m${text}\x1b[0m` : text}`
			this.#rows[row] = text
			this.#styles[row] = styles[row]
		}
		this.#rows.length = rows
		this.#styles.length = rows
		if (cursor) output += `\x1b[${Math.max(1, Math.min(rows, cursor.y + 1))};${Math.max(1, Math.min(cols, cursor.x + 1))}H\x1b[?25h`
		this.stdout.write(output)
	}
	leave() {
		if (!this.#entered) return
		this.#entered = false
		try { this.stdout.write(`\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[<u\x1b[r\x1b[0m\x1b[?25h${this.mode === 'fullscreen' ? '\x1b[?1049l' : '\n'}`) }
		finally {
			if (this.stdin.setRawMode) this.stdin.setRawMode(this.#raw)
			this.stdin.pause()
		}
	}
}
