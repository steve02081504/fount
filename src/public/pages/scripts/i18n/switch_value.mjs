/**
 * i18n switch 叶子：按参数值在 cases 中选用文案，未命中则用 default。
 * 形态：{ switch: 'count', default: '${count} items', cases?: { '1': '1 item' } }
 * cases 键除精确匹配外还支持 JS 表达式条件（在 params 作用域下同步求值，必须返回 true 才命中）：
 * { switch: 'count', default: '${count} items', cases?: { 'count >= 100': 'many' } }
 * 表达式与模板插值同作用域语义（params 顶层键直接可引用）；字面量键（如 '1'）求值非 true 永不误命中；
 * 整数键升序、其余按插入序尝试，应避免编写重叠的区间条件。
 * 求值走 sync_eval（同步）；本模块被浏览器、Deno 与 Node 测试链（page-watch locale 扫描）三方加载，
 * Node 侧的 esm.sh → npm 映射由 playwright npm_register 的 resolve hook 提供。
 * 与普通 string 叶子在跨语言类型检查中兼容（有的语言用 string，有的用 switch）。
 */
import { sync_eval } from 'https://esm.sh/@steve02081504/async-eval'

/** 已告警过的无效条件表达式（同一表达式仅提示一次，避免高频渲染刷屏）。 */
const warnedConditions = new Set()

/**
 * 求值 cases 键的表达式条件（params 顶层键直接可引用，与模板插值作用域一致）。
 * 仅当求值结果严格为 true 才命中（字面量键如 '1' 求值为 1，不会误命中）；
 * 语法错误 / 求值异常按未命中处理，同一表达式仅告警一次。
 * @param {string} key - cases 键（JS 表达式）。
 * @param {Record<string, unknown>} params - 插值参数。
 * @returns {boolean} 是否命中。
 */
function evalSwitchCondition(key, params) {
	const { error, result } = sync_eval(key, params)
	if (error) {
		if (!warnedConditions.has(key)) {
			warnedConditions.add(key)
			console.warn(`[i18n:switch] invalid condition expression: ${key}（${error}）`)
		}
		return false
	}
	return result === true
}

/**
 * @param {unknown} value locale 节点
 * @returns {boolean} 是否为 switch 叶子
 */
export function isSwitchValue(value) {
	return value?.switch && value.default != null
}

/**
 * 解析一层 switch（不插值）；未命中 cases 时回落 default。
 * cases 键先做精确匹配（快路径），未命中再逐键按 JS 表达式条件求值。
 * @param {unknown} value locale 节点
 * @param {Record<string, unknown>} [params] 插值参数（含 switch 所指字段）
 * @returns {unknown} cases 命中值或 default；非 switch 原样返回
 */
export function resolveSwitchCase(value, params = {}) {
	if (!isSwitchValue(value)) return value
	const { cases } = value
	if (!cases) return value.default
	const exact = cases[String(params[value.switch] ?? '')]
	if (exact != null) return exact
	for (const key of Object.keys(cases))
		if (evalSwitchCondition(key, params)) return cases[key]
	return value.default
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
