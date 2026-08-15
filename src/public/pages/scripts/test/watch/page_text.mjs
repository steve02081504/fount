/**
 * 可见 UI 文案提取：临时隐藏语种扫描跳过节点后读 title + body.innerText。
 * 调用方负责套 mutations.ignore，避免隐藏操作喂脏 a11y。
 * 跳过 `[user-content]` / `[language-check-ignore]` / `[aria-hidden="true"]` / `[inert]`（`.hidden` / `[hidden]` 本就不上 innerText）。
 */
import { LOCALE_CHECK_SKIP_SELECTOR } from './locale_script.mjs'

/**
 * 收集页面可见文案（含 title）；跳过 `[user-content]` / `[language-check-ignore]` / `[aria-hidden="true"]` / `[inert]`。
 * @param {Document} [doc=document] 文档
 * @returns {string} 可见文案
 */
export function collectVisiblePageText(doc = document) {
	const skipped = [...doc.querySelectorAll(`${LOCALE_CHECK_SKIP_SELECTOR}, [aria-hidden="true"], [inert]`)]
	/** @type {{ value: string, priority: string }[]} */
	const prev = []
	for (const el of skipped) {
		prev.push({
			value: el.style.getPropertyValue('display'),
			priority: el.style.getPropertyPriority('display'),
		})
		el.style.setProperty('display', 'none', 'important')
	}
	try {
		return `${doc.title}\n${doc.body?.innerText ?? ''}`
	}
	finally {
		skipped.forEach((el, i) => {
			const { value, priority } = prev[i]
			if (value) el.style.setProperty('display', value, priority)
			else el.style.removeProperty('display')
		})
	}
}
