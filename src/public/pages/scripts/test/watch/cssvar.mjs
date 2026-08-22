/**
 * CSS 变量运行时健康检测：
 * 1. 未定义：同源样式表里 `var(--x)` 无 fallback，且任何元素（含根部）都无法解析。
 *    覆盖 daisyUI 主题变量 / JS 动态 setProperty（在宿主元素上可解析），不误报。
 * 2. 未使用：同源样式表显式声明 `--x`，但测试期间从未被任何 `var()` 引用。
 *    提示要么补测试覆盖该用例，要么移除死变量。
 */
import { wake } from './loop.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:cssvar]')

let dirty = true
let drainPassDone = false

/** `var(--x[, fallback])` 引用（含 fallback）的提取：用于 unused 判定。 */
const VAR_REFERENCE_RE = /\bvar\(\s*(--[a-zA-Z0-9-]+)/g
/** 无 fallback 的 `var(--x)` 提取：用于 undefined 判定。 */
const VAR_BARE_RE = /var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g

/** 跨扫描累计：测试期间所有被引用的 CSS 变量（含 fallback），保留已移除临时节点的引用。 */
const referenced = new Set()

/**
 * DOM 变化后置脏并唤醒，确保首轮扫描后仍会重扫。
 * @returns {void}
 */
function markDirty() {
	dirty = true
	wake()
}

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
 * @param {Set<string>} bareReferences 收集无 fallback 的 `var(--x)` 用法（用于 undefined 判定）
 * @param {Set<string>} declared 收集 `--x: ...` 显式声明的变量名
 * @returns {void}
 */
function collectRules(rules, bareReferences, declared) {
	for (const rule of rules)
		try {
			if (rule.style?.length) {
				const cssText = rule.style.cssText
				for (const match of cssText.matchAll(VAR_REFERENCE_RE))
					referenced.add(match[1])
				for (const match of cssText.matchAll(VAR_BARE_RE))
					bareReferences.add(match[1])
				for (let i = 0; i < rule.style.length; i++) {
					const prop = rule.style[i]
					if (prop.startsWith('--')) declared.add(prop)
				}
			}
			if (rule.cssRules) collectRules(rule.cssRules, bareReferences, declared)
		}
		catch { /* 跨域规则不可读 */ }
}

/**
 * 收集元素 inline `style` 里的 `var(--x)` 引用（JS 模板注入的样式），归入累计引用。
 * 只统计"被引用"，不含 `setProperty('--x',…)` 这类定义。
 * @param {Set<string>} bareReferences 收集无 fallback 的 `var(--x)` 用法（用于 undefined 判定）
 * @returns {void}
 */
function collectInlineUsages(bareReferences) {
	for (const el of document.querySelectorAll('[style]')) {
		const inline = el.getAttribute('style')
		if (!inline) continue
		for (const match of inline.matchAll(VAR_REFERENCE_RE))
			referenced.add(match[1])
		for (const match of inline.matchAll(VAR_BARE_RE))
			bareReferences.add(match[1])
	}
}

/**
 * 扫描 CSS 变量健康问题。
 * @returns {{ undefinedVars: string[], unusedVars: string[] }} 未定义 / 未使用变量列表
 */
function findCssVarIssues() {
	/** @type {Set<string>} */
	const bareReferences = new Set()
	/** @type {Set<string>} */
	const declared = new Set()
	for (const sheet of document.styleSheets)
		// 只扫本域样式表（`<link href>` 解析到页面同源，含相对路径 `/scripts/*.css`）：
		// 注入的 Tailwind `<style>`（无 href）与 CDN daisyUI 的变量由各自的框架负责，
		// 不在仓库可控范围内，跳过以免误报。
		try {
			const href = sheet.href
			if (href && new URL(href, location.href).origin === location.origin)
				collectRules(sheet.cssRules, bareReferences, declared)
		}
		catch { /* 跨域样式表跳过 */ }
	collectInlineUsages(bareReferences)

	const rootStyle = getComputedStyle(document.documentElement)
	/** @type {Set<string>} */
	const undefinedVars = new Set()
	for (const name of bareReferences) {
		if (rootStyle.getPropertyValue(name).trim()) continue
		if (declared.has(name)) continue
		undefinedVars.add(name)
	}
	// 单次遍历元素：每元素仅一次 getComputedStyle，从候选集中消解已定义变量，
	// 确保最终只报告全页面都未定义的变量。
	/** @type {Set<string>} */
	const definedOnElement = new Set()
	for (const el of document.querySelectorAll('*')) {
		if (definedOnElement.size === undefinedVars.size) break
		const style = getComputedStyle(el)
		for (const name of undefinedVars)
			if (!definedOnElement.has(name) && style.getPropertyValue(name).trim())
				definedOnElement.add(name)
	}
	for (const name of definedOnElement) undefinedVars.delete(name)

	const unusedVars = [...declared].filter(name => !referenced.has(name)).sort()
	return { undefinedVars: [...undefinedVars].sort(), unusedVars }
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
		const { undefinedVars, unusedVars } = findCssVarIssues()
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

/**
 * 导出 markDirty，供 mutations 观察者在 DOM 变化时联动置脏并重扫。
 */
export { markDirty }
