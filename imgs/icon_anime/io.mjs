/**
 * 图标 TUI 的 console / stdin / stdout 绑定。
 * stdout 缺省取 `console._stdout`（与 Node + virtual-console 一致）。
 */

const [playerHost, termHost] = await Promise.all([
	globalThis.document ? import('./player/browser.mjs') : import('./player/node.mjs'),
	globalThis.document ? import('./terminal/browser.mjs') : import('./terminal/node.mjs'),
])

/** @typedef {{ write: (text: string) => unknown, columns?: number, rows?: number, isTTY?: boolean, writable?: boolean, targetStream?: { write: (text: string) => unknown }, on?: Function, off?: Function }} IoStdout */
/** @typedef {{ isTTY?: boolean, setRawMode?: (mode: boolean) => void, resume?: () => void, pause?: () => void, on?: Function, off?: Function }} IoStdin */

let activeConsole = playerHost.defaultConsole
/** @type {IoStdin | undefined} */
let activeStdin = playerHost.defaultStdin
/** @type {IoStdout | undefined} */
let activeStdout = playerHost.defaultStdout
const supportsAnsi = termHost.defaultSupportsAnsi

/**
 * 绑定播放器用的 console / stdin / stdout。
 * 可传 DOM `setTerminal` 的返回值：`setIO(terminal)`（用其 `.console` / `.stdin` / `.stdout`）。
 * 也可传字段包；未给出 `stdout` 字段时改为当前 `console._stdout`（不保留旧 stdout）。
 * @param {{
 *   console?: { block?: () => void, unblock?: () => boolean, _stdout?: IoStdout },
 *   stdin?: IoStdin,
 *   stdout?: IoStdout,
 * }} [io] 终端或 IO 字段；缺省只按当前 console 刷新 stdout
 * @returns {object | undefined} 调用时的 `this`（`icon.setIO(io).intro()`）
 */
export function setIO(io = {}) {
	if (io.console) activeConsole = io.console
	if ('stdout' in io) activeStdout = io.stdout
	else activeStdout = activeConsole._stdout
	if ('stdin' in io) activeStdin = io.stdin
	return this
}

/**
 * 当前绑定的 IO。
 * @returns {{ console: typeof activeConsole, stdin: IoStdin | undefined, stdout: IoStdout | undefined }} IO
 */
export const getIO = () => ({
	console: activeConsole,
	stdin: activeStdin,
	stdout: activeStdout,
})

/**
 * 备用屏 / raw stdin 是否可用。
 * @returns {boolean} 是否可进入 TUI
 */
export const canUseTui = () => Boolean(
	activeStdin?.isTTY
	&& activeStdout?.isTTY
	&& activeStdout.writable !== false
	&& activeStdout.targetStream
	&& supportsAnsi,
)

/**
 * @returns {{ columns: number, rows: number }} 终端尺寸
 */
export const terminalSize = () => ({
	columns: activeStdout?.columns || 0,
	rows: activeStdout?.rows || 0,
})

/**
 * 订阅终端尺寸变化；回调收到当前 `terminalSize()`。
 * @param {(size: { columns: number, rows: number }) => void} listener 尺寸回调
 * @returns {() => void} 取消订阅
 */
export function watchTerminalSize(listener) {
	const stdout = activeStdout
	if (!stdout?.on) return () => { /* 无 resize 源 */ }
	/** @returns {void} */
	const onResize = () => listener(terminalSize())
	stdout.on('resize', onResize)
	return () => stdout.off?.('resize', onResize)
}
