/**
 * CSS 变量运行时健康检测：
 * 1. 未定义：同源样式表里 `var(--x)` 无 fallback，且任何元素（含根部）都无法解析。
 *    覆盖 daisyUI 主题变量 / JS 动态 setProperty（在宿主元素上可解析），不误报。
 * 2. 未使用：同源样式表显式声明 `--x`，但测试期间从未被任何 `var()` 引用。
 *    提示要么补测试覆盖该用例，要么移除死变量。
 *
 * 外部消费出口（注释指令，零运行时影响）：在样式表注释里写 `cssvar-external: --btn-color`
 * 表示该变量被扫描范围外的消费者使用（如 daisyUI CDN 按钮主题桥 `--btn-color`）——扫描器读不到
 * 跨域样式表，这类主题钩子会误报为死变量。指令值 = 交给外部消费的 `--*` 名单（空白分隔）。
 * CSSOM 会剥掉注释，故同源 `<link>` 样式表需 fetch 原文解析；inline `<style>` 直接读
 * `ownerNode.textContent`。
 */
import { wake } from './loop.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:cssvar]')

/** 样式表注释里的外部消费指令前缀（`cssvar-external: --x --y`）。 */
const EXTERNAL_DIRECTIVE_RE = /\bcssvar-external\s*:\s*([^*/]*)/g

/**
 * 从样式表原文解析 `cssvar-external` 注释指令，返回外部消费的变量名单。
 * @param {string} cssText 样式表原文（含注释）
 * @returns {string[]} 名单中的 `--*` 名
 */
export function parseExternalDirectives(cssText) {
	const names = []
	for (const match of String(cssText).matchAll(EXTERNAL_DIRECTIVE_RE))
		names.push(...match[1].match(/--[a-zA-Z0-9_-]+/g) ?? [])
	return names
}

let dirty = true
let drainPassDone = false

/** `var(--x[, fallback])` 引用（含 fallback）的提取：用于 unused 判定。 */
const VAR_REFERENCE_RE = /\bvar\(\s*(--[a-zA-Z0-9_-]+)/g
/** 无 fallback 的 `var(--x)` 提取：用于 undefined 判定。 */
const VAR_BARE_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g

/** 跨扫描累计：测试期间所有被引用的 CSS 变量（含 fallback），保留已移除临时节点的引用。 */
const referenced = new Set()
/** 跨扫描累计：注释指令声明的「外部消费」变量（unused 判定豁免）。 */
const externalConsumers = new Set()
/** 已 fetch 过的同源 `<link>` 样式表原文缓存（href → 文本；失败为 null 只读一次）。 */
const sheetTextCache = new Map()

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
				for (let index = 0; index < rule.style.length; index++) {
					const property = rule.style[index]
					if (property.startsWith('--')) declared.add(property)
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
	for (const element of document.querySelectorAll('[style]')) {
		const inline = element.getAttribute('style')
		if (!inline) continue
		for (const match of inline.matchAll(VAR_REFERENCE_RE))
			referenced.add(match[1])
		for (const match of inline.matchAll(VAR_BARE_RE))
			bareReferences.add(match[1])
	}
}

/**
 * 读取同源样式表原文里的 `cssvar-external` 注释指令并入外部消费名单。
 * 同源 `<link>` 用 fetch（只取一次，失败按无指令处理）；inline `<style>` 同步读
 * `ownerNode.textContent`（CSSOM 剥注释，但原文仍在）。
 * @returns {Promise<void>}
 */
async function collectExternalDirectives() {
	const styleSheets = [...document.styleSheets]
	const inlineTexts = []
	const hrefsToFetch = []
	for (const sheet of styleSheets) 
		try {
			if (sheet.href) {
				const url = new URL(sheet.href, location.href)
				if (url.origin === location.origin) hrefsToFetch.push(url.href)
			}
			else {
				// 无 href 的 `<style>`：CSSOM 不可读注释，直接读 ownerNode 原文
				const text = sheet.ownerNode?.textContent
				if (text) inlineTexts.push(text)
			}
		}
		catch { /* 跨域样式表跳过 */ }
	
	for (const href of hrefsToFetch) {
		if (sheetTextCache.has(href)) continue
		sheetTextCache.set(href, fetch(href).then(
			response => response.ok ? response.text() : '',
			() => '',
		).catch(() => ''))
	}
	const [inlineNames, ...fetchedNames] = await Promise.all([
		Promise.resolve(inlineTexts.flatMap(text => parseExternalDirectives(text))),
		...hrefsToFetch.map(href => sheetTextCache.get(href).then(
			text => parseExternalDirectives(text),
			() => [],
		)),
	])
	for (const name of [...inlineNames, ...fetchedNames.flat()]) externalConsumers.add(name)
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
		// 是否已定义仅由实际引用元素的计算样式决定（见下方单次遍历），
		// 不因同源样式表里出现 `--x: ...` 声明（可能来自无关或未挂载的规则）而视为已定义。
		if (rootStyle.getPropertyValue(name).trim()) continue
		undefinedVars.add(name)
	}
	// 单次遍历元素：每元素仅一次 getComputedStyle，从候选集中消解已定义变量，
	// 确保最终只报告全页面都未定义的变量。
	/** @type {Set<string>} */
	const definedOnElement = new Set()
	for (const element of document.querySelectorAll('*')) {
		if (definedOnElement.size === undefinedVars.size) break
		const style = getComputedStyle(element)
		for (const name of undefinedVars)
			if (!definedOnElement.has(name) && style.getPropertyValue(name).trim())
				definedOnElement.add(name)
	}
	for (const name of definedOnElement) undefinedVars.delete(name)

	const unusedVars = [...declared].filter(name => !referenced.has(name) && !externalConsumers.has(name)).sort()
	return { undefinedVars: [...undefinedVars].sort(), unusedVars }
}

/**
 * loop 回调：先收集外部消费指令（含 fetch 同源样式表原文），再跑一轮扫描。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {Promise<boolean>} true = 空转
 */
async function run({ draining }) {
	if (!dirty && !(draining && !drainPassDone)) return true
	dirty = false
	try {
		await collectExternalDirectives()
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
				'已声明但测试期间从未被引用：要么拓展测试覆盖该用例，要么移除死变量；'
				+ '若它交给扫描范围外的消费者（如 daisyUI CDN 主题桥），在同规则注释里写 `cssvar-external: <名>` 即可豁免',
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