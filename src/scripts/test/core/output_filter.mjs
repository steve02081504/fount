import { removeTerminalSequences } from 'npm:@steve02081504/exec'

/**
 * 高信号噪声模式（均在去除终端转义后的文本上检测）。
 * @type {RegExp[]}
 */
const NOISE_PATTERNS = [/Error:/, /\bWARN\b/, /\brejection\b/i]

/**
 * 输出是否含应展示的噪声（Error / WARN / rejection）。
 * @param {string} text 子进程 stdall
 * @returns {boolean} 是否含噪声
 */
export function outputHasNoise(text) {
	const plain = removeTerminalSequences(text)
	return NOISE_PATTERNS.some(pattern => pattern.test(plain))
}
