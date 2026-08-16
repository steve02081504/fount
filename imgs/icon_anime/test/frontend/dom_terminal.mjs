/**
 * DOM 终端测试页：挂 xterm、把 IO 交给 icon session。
 */
import { setTerminal } from '/scripts/components/terminal.mjs'
import { dismiss, setIO, start } from '/imgs/icon_anime/session.mjs'

const terminal = setTerminal(document.getElementById('term'))
setIO(terminal)

/**
 * @param {{ length: number, getLine: (y: number) => { translateToString: (trim: boolean) => string } }} buffer xterm 缓冲
 * @returns {string} 纯文本
 */
const bufferText = buffer => {
	const lines = []
	for (let y = 0; y < buffer.length; y++)
		lines.push(buffer.getLine(y).translateToString(true))
	return lines.join('\n')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @param {() => boolean} ready 条件
 * @param {number} timeout 毫秒
 * @returns {Promise<void>}
 */
const until = async (ready, timeout) => {
	for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(50))
		if (ready()) return
	throw new Error('timeout')
}

/**
 * 写入标记 → 播放 → dismiss，返回主缓冲快照。
 * @param {string} marker 主缓冲标记
 * @returns {Promise<{ before: string, afterStop: string, later: string }>} 快照
 */
export async function playAndRestore(marker) {
	await new Promise(resolve => terminal.write(marker, resolve))
	const before = bufferText(terminal.buffer.normal)
	void start()
	await until(() => terminal.buffer.active.type === 'alternate' && bufferText(terminal.buffer.active).trim(), 15_000)
	await dismiss()
	await until(() => terminal.buffer.active.type === 'normal', 10_000)
	const afterStop = bufferText(terminal.buffer.normal)
	await sleep(400)
	return { before, afterStop, later: bufferText(terminal.buffer.normal) }
}
