/**
 * 【文件】public/src/lib/format.mjs — Agent Studio 前端格式化助手
 * 【职责】提供天数换算、文本截断、时间本地化等纯函数。
 * 【原理】无副作用，供各视图复用。
 * 【关联】views/*、lib/generationDialog.mjs。
 */

/** 每天的毫秒数。 */
export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 把毫秒转换为天数（保留两位小数）。
 * @param {number} ms 毫秒
 * @returns {number} 天数
 */
export function msToDays(ms) {
	return Math.round((ms / DAY_MS) * 100) / 100
}

/**
 * 把天数输入转换为毫秒；非正数记为 0。
 * @param {string} value 输入值
 * @returns {number} 毫秒
 */
export function daysToMs(value) {
	const days = Number(value)
	return Number.isFinite(days) && days > 0 ? days * DAY_MS : 0
}

/**
 * 截断文本，超出时追加省略号。
 * @param {unknown} value 原值
 * @param {number} [max] 最大长度
 * @returns {string} 截断后的文本
 */
export function truncate(value, max = 80) {
	const text = String(value ?? '')
	return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * 把毫秒时间戳按指定 locale 格式化为可读字符串。
 * @param {number} [ms] 毫秒时间戳
 * @param {string} [locale] BCP 47 locale（缺省用浏览器 locale）
 * @returns {string} 本地时间；无效时为空串
 */
export function formatTime(ms, locale) {
	if (!ms) return ''
	return new Date(ms).toLocaleString(locale)
}

/**
 * 清洗文件名中的非法字符。
 * @param {string} name 原始文件名
 * @returns {string} 安全文件名
 */
export function safeFilename(name) {
	return String(name ?? '').replace(/[\\/:*?"<>|]/g, '_')
}
