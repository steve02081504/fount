import { inspect } from 'node:util'

/**
 * 把任意抛出值格式化为可读文本，统一生成失败报告 / 记录 / 展示层的错误字符串化。
 *
 * `Error` 优先用 `stack`；数组逐项递归并以分隔线拼接；其余值用 `util.inspect`，
 * 避免 `String({ ... })` 退化成 `[object Object]`（如 AI 源抛出普通对象时）。
 * @param {unknown} value - 捕获到的抛出值。
 * @returns {string} 可读文本。
 */
export function formatGenerationError(value) {
	if (value instanceof Error) return value.stack || value.message || inspect(value)
	if (Array.isArray(value)) return value.map(formatGenerationError).join('\n---\n')
	return inspect(value)
}

/**
 * 取错误的最简可读描述：有 `message` 就用它，否则退回 {@link formatGenerationError}。
 *
 * 供记录字段 / 一行摘要使用，避免重复写 `error?.message ?? formatGenerationError(error)`；
 * 普通对象、数组、原始值都会走完整格式化，不会退化成 `[object Object]`。
 * @param {unknown} value - 捕获到的抛出值。
 * @returns {string} 最简描述。
 */
export function formatErrorMessage(value) {
	return value?.message ?? formatGenerationError(value)
}

