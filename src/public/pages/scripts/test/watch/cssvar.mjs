/**
 * CSS 变量运行时健康检测：
 * 1. 未定义：同源样式表里 `var(--x)` 无 fallback，且任何元素（含根部）都无法解析。
 *    覆盖 daisyUI 主题变量 / JS 动态 setProperty（在宿主元素上可解析），不误报。
 * 2. 未使用：同源样式表显式声明 `--x`，但测试期间从未被任何 `var()` 引用。
 *    提示要么补测试覆盖该用例，要么移除死变量。
 */
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:cssvar]')

let dirty = true
let drainPassDone = false

/**
 * drain 覆盖是否完成。
 * @returns {boolean} 本轮 drain cssvar 已跑完则为 true
 */
function covered() {
	return drainPassDone
}

/**
 * drain 开始：重置覆盖并要求扫描。
 * @returns {void}
 */
function beginDrain() {
	drainPassDone = false
	dirty = true
}

/**
 * 遍历样式规则，收集用到 CSS 变量的声明与显式声明的变量名。
 * 跨域样式表（CDN daisyUI / tailwind）的规则无法读取，跳过。
 * @param {CSSRuleList} rules 规则列表
 * @param {Set<string>} usages 收集 `var(--x)` 用法（变量名含 `--`）
 * @param {Set<string>} declared 收集 `--x: ...` 显式声明的变量名
 * @returns {void}
 */
function collectRules(rules, usages, declared) {
	for (const rule of rules)
		try {
			if (rule.style && rule.style.length) {
				const cssText = rule.style.cssText
				for (const match of cssText.matchAll(/var\(\s*--([a-zA-Z0-9-]+)\s*\)/g))
					usages.add(`--${match[1]}`)
				for (let i = 0; i < rule.style.length; i++) {
					const prop = rule.style[i]
					if (prop.startsWith('--')) declared.add(prop)
				}
			}
			if (rule.cssRules) collectRules(rule.cssRules, usages, declared)
		}
		catch { /* 跨域规则不可读 */ }
}

/**
 * 收集元素 inline `style` 里的 `var(--x)` 引用（JS 模板注入的样式），归入 usages。
 * 只统计"被引用"，不含 `setProperty('--x',…)` 这类定义。
 * @param {Set<string>} usages 已收集的用法集合（变量名含 `--`）
 * @returns {void}
 */
function collectInlineUsages(usages) {
	for (const el of document.querySelectorAll('[style]')) {
		const inline = el.getAttribute('style')
		if (!inline) continue
		for (const match of inline.matchAll(/var\(\s*--([a-zA-Z0-9-]+)\s*\)/g))
			usages.add(`--${match[1]}`)
	}
}

/**
 * 扫描 CSS 变量健康问题。
 * @returns {{ undefined: string[], unused: string[] }} 未定义 / 未使用变量列表
 */
function findCssVarIssues() {
	/** @type {Set<string>} */
	const usages = new Set()
	/** @type {Set<string>} */
	const declared = new Set()
	for (const sheet of document.styleSheets)
		// 只扫本域样式表（`<link href>` 解析到页面同源，含相对路径 `/scripts/*.css`）：
		// 注入的 Tailwind `<style>`（无 href）与 CDN daisyUI 的变量由各自的框架负责，
		// 不在仓库可控范围内，跳过以免误报。
		try {
			const href = sheet.href
			if (href && new URL(href, location.href).origin === location.origin)
				collectRules(sheet.cssRules, usages, declared)
		}
		catch { /* 跨域样式表跳过 */ }
	collectInlineUsages(usages)

	const rootStyle = getComputedStyle(document.documentElement)
	const undefinedVars = new Set()
	/** @type {Set<string>} */
	const elementScanned = new Set()
	for (const name of usages) {
		if (rootStyle.getPropertyValue(name).trim()) continue
		if (declared.has(name)) continue
		if (elementScanned.has(name)) continue
		elementScanned.add(name)
		if (!isDefinedOnAnyElement(name))
			undefinedVars.add(name)
	}

	const unusedVars = [...declared].filter(name => !usages.has(name)).sort()
	return { undefined: [...undefinedVars].sort(), unused: unusedVars }
}

/**
 * 判断某个 CSS 变量是否在任意元素上可解析。
 * @param {string} name 变量名（含 `--`）
 * @returns {boolean} 已定义则为 true
 */
function isDefinedOnAnyElement(name) {
	for (const el of document.querySelectorAll('*'))
		if (getComputedStyle(el).getPropertyValue(name).trim())
			return true
	return false
}

/**
 * loop 回调：跑一轮或空转。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {Promise<boolean>} true = 空转
 */
async function run({ draining }) {
	if (!dirty && !(draining && !drainPassDone)) return true
	dirty = false
	try {
		const { undefined: undefinedVars, unused: unusedVars } = findCssVarIssues()
		for (const name of undefinedVars)
			reporter.report(
				`undefined-css-var\t${name}`,
				'undefined-css-var',
				name,
				'引用但无任何元素定义该 CSS 变量：要么补上定义，要么移除该用法',
			)
		for (const name of unusedVars)
			reporter.report(
				`unused-css-var\t${name}`,
				'unused-css-var',
				name,
				'已声明但测试期间从未被引用：要么拓展测试覆盖该用例，要么移除死变量',
			)
	}
	finally {
		if (draining) drainPassDone = true
	}
	return false
}

/** 任务轮转间隔 */
const CSS_VAR_SCAN_MS = 500

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'cssvar', delayMs: CSS_VAR_SCAN_MS, run, covered, beginDrain }
