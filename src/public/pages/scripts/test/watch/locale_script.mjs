/**
 * 语种脚本约束（可见文案 + aria-label）：纯函数，供 locale watcher / selftest 共用。
 */

/** 英语：不得出现汉字 / 假名；中文：不得出现平假名 / 片假名 */
export const SCRIPT_FORBIDDEN = {
	'en-UK': /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
	'zh-CN': /\p{Script=Hiragana}|\p{Script=Katakana}/u,
}

/**
 * 中文 / 日语页面：aria-label 必须带上对应文字脚本（禁止纯英文占位）。
 * 日语接受假名或汉字（短标签常为纯汉字）。
 */
export const ARIA_LABEL_REQUIRED_SCRIPT = {
	'zh-CN': /\p{Script=Han}/u,
	'ja-JP': /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u,
}

/**
 * @param {string} locale 当前主 locale（或可被 match 的标签）
 * @param {(preferred: string[], available: string[]) => string | null | undefined} matchLocale i18n.matchLocale
 * @param {string[]} available 候选 locale 列表
 * @returns {string | null} 命中的规范 locale；未命中为 null
 */
export function matchKnownLocale(locale, matchLocale, available) {
	const matched = matchLocale([locale], available)
	return matched || null
}

/**
 * aria-label 相对当前语种的问题码；合规为 null。
 * @param {string} localeNorm 已规范到 zh-CN / ja-JP / en-UK（或其它）
 * @param {string} label aria-label 文本
 * @param {RegExp | null} [jaForbidden] 简体相对日语的禁止汉字；仅 ja 使用
 * @returns {'missing-zh' | 'missing-ja' | 'forbidden-script' | null} 问题码
 */
export function ariaLabelLocaleProblem(localeNorm, label, jaForbidden = null) {
	const text = String(label || '').trim()
	if (!text) return null

	if (localeNorm === 'zh-CN') {
		if (SCRIPT_FORBIDDEN['zh-CN'].test(text)) return 'forbidden-script'
		if (!ARIA_LABEL_REQUIRED_SCRIPT['zh-CN'].test(text)) return 'missing-zh'
		return null
	}
	if (localeNorm === 'ja-JP') {
		if (jaForbidden?.test(text)) return 'forbidden-script'
		if (!ARIA_LABEL_REQUIRED_SCRIPT['ja-JP'].test(text)) return 'missing-ja'
		return null
	}
	if (localeNorm === 'en-UK') {
		if (SCRIPT_FORBIDDEN['en-UK'].test(text)) return 'forbidden-script'
		return null
	}
	return null
}

/**
 * 收集应接受语种检查的 aria-label（跳过 user-content / 隐藏 / aria-hidden / inert）。
 * @param {ParentNode} [root=document] 扫描根
 * @returns {{ label: string, where: string }[]} 条目
 */
export function collectAriaLabelsForLocaleCheck(root = document) {
	/** @type {{ label: string, where: string }[]} */
	const out = []
	if (!root?.querySelectorAll) return out
	for (const el of root.querySelectorAll('[aria-label]')) {
		if (!(el instanceof Element)) continue
		if (el.closest('[user-content]')) continue
		if (el.closest('[aria-hidden="true"]')) continue
		if (el.closest('[inert]')) continue
		if (el.closest('[hidden], .hidden')) continue
		const label = el.getAttribute('aria-label')
		if (label == null || !String(label).trim()) continue
		out.push({ label: String(label).trim(), where: describeElement(el) })
	}
	return out
}

/**
 * @param {Element} el 元素
 * @returns {string} 简短定位串
 */
function describeElement(el) {
	if (el.id) return `#${CSS.escape(el.id)}`
	const cls = typeof el.className === 'string'
		? el.className.trim().split(/\s+/).find(Boolean)
		: ''
	if (cls) return `${el.tagName.toLowerCase()}.${CSS.escape(cls)}`
	return el.tagName.toLowerCase()
}
