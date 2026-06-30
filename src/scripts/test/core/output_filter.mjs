import { removeTerminalSequences } from 'npm:@steve02081504/exec'

/** Deno npm 依赖解析时的 Initialize 行（去 ANSI 后为 `Initialize pkg@ver`）。 */
const DENO_INIT_LINE = /^Initialize\s+\S/

/** 噪声豁免窗口 begin 标记（后接 tab + regex）。 */
export const NOISE_ALLOW_BEGIN = '@@FOUNT_NOISE_ALLOW_BEGIN@@'

/** 噪声豁免窗口 end 标记（就近 LIFO 出栈，不带 regex）。 */
export const NOISE_ALLOW_END = '@@FOUNT_NOISE_ALLOW_END@@'

const NOISE_ALLOW_BEGIN_RE = new RegExp(`^${NOISE_ALLOW_BEGIN}\\t(.+)$`)
const NOISE_ALLOW_END_RE = new RegExp(`^${NOISE_ALLOW_END}$`)

/**
 * 格式化噪声豁免窗口 begin 行。
 * @param {string} pattern 行匹配用 regex 字符串
 * @returns {string} sentinel 行
 */
export function formatNoiseAllowBegin(pattern) {
	return `${NOISE_ALLOW_BEGIN}\t${pattern}`
}

/**
 * 格式化噪声豁免窗口 end 行。
 * @returns {string} sentinel 行
 */
export function formatNoiseAllowEnd() {
	return NOISE_ALLOW_END
}

/**
 * 将 pattern 编译为 RegExp；非法 pattern 按字面量转义。
 * @param {string} pattern regex 或字面量
 * @returns {RegExp} 用于行匹配
 */
function compileAllowPattern(pattern) {
	try {
		return new RegExp(pattern)
	}
	catch {
		return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	}
}

/**
 * 去除测试输出中的低信号行（Deno Initialize 等）。
 * @param {string} text 子进程 stdall
 * @returns {string} 过滤后的文本
 */
export function filterTestOutput(text) {
	if (!text) return text
	return text.split(/\r?\n/)
		.filter(line => !DENO_INIT_LINE.test(removeTerminalSequences(line)))
		.join('\n')
}

/**
 * 去除噪声豁免窗口 sentinel 行（供日志落盘与打印）。
 * @param {string} text 子进程 stdall
 * @returns {string} 去掉标记行后的文本
 */
export function stripNoiseMarkers(text) {
	if (!text) return text
	return text.split(/\r?\n/)
		.filter(line => {
			const plain = removeTerminalSequences(line)
			return !NOISE_ALLOW_BEGIN_RE.test(plain) && !NOISE_ALLOW_END_RE.test(plain)
		})
		.join('\n')
}

/**
 * 高信号噪声规则（均在去除终端转义后的文本上检测）。
 * @type {{ name: string, pattern: RegExp }[]}
 */
const NOISE_RULES = [
	{ name: 'Error', pattern: /Error:/ },
	{ name: 'WARN', pattern: /\bWARN\b/ },
	{ name: 'rejection', pattern: /\brejection\b/i },
]

const IMBALANCE_HIT = 'noise_allow_imbalance'

/**
 * 行是否被当前活动豁免窗口覆盖。
 * @param {string} line 单行文本（已去 ANSI）
 * @param {RegExp[]} allowStack 活动窗口 pattern 栈
 * @returns {boolean} 是否豁免
 */
function isLineAllowedByStack(line, allowStack) {
	for (const pattern of allowStack) 
		if (pattern.test(line)) return true
	
	return false
}

/**
 * 返回输出中命中的噪声规则名（尊重噪声豁免窗口）。
 * @param {string} text 子进程 stdall
 * @returns {string[]} 命中的规则名（去重保序）
 */
export function detectNoiseHits(text) {
	if (!text) return []
	const plain = removeTerminalSequences(text)
	/** @type {string[]} */
	const hits = []
	/** @type {RegExp[]} */
	const allowStack = []
	let imbalance = false

	for (const line of plain.split(/\r?\n/)) {
		const beginMatch = NOISE_ALLOW_BEGIN_RE.exec(line)
		if (beginMatch) {
			allowStack.push(compileAllowPattern(beginMatch[1]))
			continue
		}
		if (NOISE_ALLOW_END_RE.test(line)) {
			if (!allowStack.length) imbalance = true
			else allowStack.pop()
			continue
		}

		for (const { name, pattern } of NOISE_RULES) {
			if (!pattern.test(line)) continue
			if (isLineAllowedByStack(line, allowStack)) continue
			if (!hits.includes(name)) hits.push(name)
		}
	}

	if (allowStack.length) imbalance = true
	if (imbalance && !hits.includes(IMBALANCE_HIT)) hits.push(IMBALANCE_HIT)

	return hits
}

/**
 * 输出是否含应展示的噪声（Error / WARN / rejection / 窗口不平衡）。
 * @param {string} text 子进程 stdall
 * @returns {boolean} 是否含噪声
 */
export function outputHasNoise(text) {
	return detectNoiseHits(text).length > 0
}
