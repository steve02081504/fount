/**
 * 按「一字一 token」估算的表意 / 音节文字区段：CJK 汉字及部首、假名、谚文、
 * 注音、全角形式，以及 emoji 等单字符表意符号。
 */
const IDEOGRAPHIC_RANGES = [
	[0x1100, 0x11FF], // 谚文字母
	[0x2E80, 0x303F], // CJK 部首 / 康熙部首 / CJK 符号与标点
	[0x3040, 0x30FF], // 平假名 / 片假名
	[0x3100, 0x33FF], // 注音 / 谚文兼容字母 / CJK 笔画 / CJK 兼容
	[0x3400, 0x4DBF], // CJK 扩展 A
	[0x4E00, 0x9FFF], // CJK 基本区
	[0xA960, 0xA97F], // 谚文字母扩展 A
	[0xAC00, 0xD7FF], // 谚文音节 / 扩展 B
	[0xF900, 0xFAFF], // CJK 兼容汉字
	[0xFE30, 0xFE4F], // CJK 兼容形式
	[0xFF00, 0xFFEF], // 半角及全角形式
	[0x1F300, 0x1FAFF], // emoji / 绘文字
	[0x20000, 0x2FA1F], // CJK 扩展 B–F 及兼容补充
]

/**
 * 判断码点是否属于表意 / 音节文字（每字符约一个 token）。
 * @param {number} codePoint - Unicode 码点。
 * @returns {boolean} 是否属于高 token 密度区段。
 */
function isIdeographicCodePoint(codePoint) {
	for (const [start, end] of IDEOGRAPHIC_RANGES)
		if (codePoint >= start && codePoint <= end) return true
	return false
}

/**
 * 无本地 tokenizer 或调用失败时的通用近似：ASCII 约 4 字符/token，
 * 表意 / 音节文字（汉字、假名、谚文、注音、全角、emoji 等）约 1 字符/token，
 * 其余非 ASCII 字母文字约 2 字符/token。
 * 思路对齐 opencode 的 `length / 4`，并据字符集细分。
 * @param {string} prompt - 待估算文本。
 * @returns {number} 估算的 token 数。
 */
export function estimateTokenCount(prompt) {
	if (!prompt) return 0
	let tokens = 0
	for (const char of String(prompt)) {
		const codePoint = char.codePointAt(0)
		if (codePoint <= 0x7F) tokens += 0.25
		else tokens += isIdeographicCodePoint(codePoint) ? 1 : 0.5
	}
	return Math.ceil(tokens)
}

/**
 * 取多个 AI 源中最小的已知上下文大小；全部未知时返回 undefined。
 * 供代理 / 包装源向调用方暴露保守的可用上下文。
 * @param {Iterable<{context_size?: number}>} sources - AI 源集合。
 * @returns {number|undefined} 最小已知上下文大小。
 */
export function minKnownContextSize(sources) {
	let min
	for (const source of sources) {
		const size = source?.context_size
		if (typeof size === 'number' && Number.isFinite(size) && (min == null || size < min))
			min = size
	}
	return min
}

/**
 * 恒等分词器：encode/decode 原样返回，token 数用字符估算近似。
 */
export const identityTokenizer = {
	/**
	 * 释放分词器。
	 * @returns {number} 0
	 */
	free: () => 0,
	/**
	 * 编码提示。
	 * @param {string} prompt - 文本。
	 * @returns {string} 原文。
	 */
	encode: prompt => prompt,
	/**
	 * 解码令牌。
	 * @param {string} tokens - 令牌。
	 * @returns {string} 原文。
	 */
	decode: tokens => tokens,
	/**
	 * 解码单个令牌。
	 * @param {string} token - 令牌。
	 * @returns {string} 原文。
	 */
	decode_single: token => token,
	/**
	 * 估算 token 数。
	 * @param {string} prompt - 文本。
	 * @returns {number} token 估算数。
	 */
	get_token_count: estimateTokenCount,
}
