/**
 * i18n switch 叶子：按参数值在 cases 中选用文案，未命中则用 default。
 * 形态：{ switch: 'count', default: '${count} items', cases?: { '1': '1 item' } }
 * 与普通 string 叶子在跨语言类型检查中兼容（有的语言用 string，有的用 switch）。
 */

/**
 * @param {unknown} value locale 节点
 * @returns {boolean} 是否为 switch 叶子
 */
export function isSwitchValue(value) {
	return value?.switch && value.default != null
}

/**
 * 解析一层 switch（不插值）；未命中 cases 时回落 default。
 * @param {unknown} value locale 节点
 * @param {Record<string, unknown>} [params] 插值参数（含 switch 所指字段）
 * @returns {unknown} cases 命中值或 default；非 switch 原样返回
 */
export function resolveSwitchCase(value, params = {}) {
	if (!isSwitchValue(value)) return value
	return value.cases?.[String(params[value.switch] ?? '')] ?? value.default
}

/**
 * string 与 switch 在跨语言共有路径上视为同一种叶子。
 * @param {unknown} a 一侧
 * @param {unknown} b 另一侧
 * @returns {boolean} 是否兼容
 */
export function areLocaleLeafKindsCompatible(a, b) {
	return (typeof a === 'string' || isSwitchValue(a)) && (typeof b === 'string' || isSwitchValue(b))
}
