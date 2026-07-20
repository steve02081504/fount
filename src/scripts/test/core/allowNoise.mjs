/**
 * 在声明的噪声豁免窗口内执行异步操作（begin/end 标记写入 stderr，与 node stderr 按 stdall 时间序交错）。
 */
import {
	formatNoiseAllowBegin,
	formatNoiseAllowEnd,
} from './output_filter.mjs'

/** 关窗前等待跨进程 node stderr 异步到达的默认毫秒（如 WS 拒绝日志晚于客户端 onerror）。 */
export const NOISE_ALLOW_STDERR_DRAIN_MS = 300

/**
 * 在噪声豁免窗口内执行 fn；窗口内匹配 patterns 的噪声行可被框架忽略。
 * @template T
 * @param {string | string[]} patterns 行匹配 regex（或字面量）
 * @param {() => T | Promise<T>} fn 待执行操作
 * @param {object} [options] 选项
 * @param {number} [options.drainMs=NOISE_ALLOW_STDERR_DRAIN_MS] 关窗前等待 stderr 交错的毫秒；0 禁用
 * @returns {Promise<T>} fn 的返回值
 */
export async function allowNoise(patterns, fn, options = {}) {
	const { drainMs = NOISE_ALLOW_STDERR_DRAIN_MS } = options
	const list = Array.isArray(patterns) ? patterns : [patterns]
	for (const pattern of list)
		console.error(formatNoiseAllowBegin(pattern))
	try {
		return await fn()
	}
	finally {
		if (drainMs > 0)
			await new Promise(resolve => { setTimeout(resolve, drainMs) })
		for (let i = 0; i < list.length; i++)
			console.error(formatNoiseAllowEnd())
	}
}
