import { removeTerminalSequences } from 'npm:@steve02081504/exec'

/**
 * 高信号噪声规则（均在去除终端转义后的文本上检测）。
 * @type {{ name: string, pattern: RegExp }[]}
 */
const NOISE_RULES = [
	{ name: 'Error', pattern: /Error:/ },
	{ name: 'WARN', pattern: /\bWARN\b/ },
	{ name: 'rejection', pattern: /\brejection\b/i },
]

/**
 * 输出是否含应展示的噪声（Error / WARN / rejection）。
 * @param {string} text 子进程 stdall
 * @returns {boolean} 是否含噪声
 */
export function outputHasNoise(text) {
	return detectNoiseHits(text).length > 0
}

/**
 * 返回输出中命中的噪声规则名。
 * @param {string} text 子进程 stdall
 * @returns {string[]} 命中的规则名（去重保序）
 */
export function detectNoiseHits(text) {
	const plain = removeTerminalSequences(text)
	/** @type {string[]} */
	const hits = []
	for (const { name, pattern } of NOISE_RULES) 
		if (pattern.test(plain)) hits.push(name)
	
	return hits
}
