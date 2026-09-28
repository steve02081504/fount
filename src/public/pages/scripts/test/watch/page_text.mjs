/**
 * 可见 UI 文案提取：临时隐藏语种扫描跳过节点后读 title + body.innerText。
 * 调用方负责套 mutations.ignore，避免隐藏操作喂脏 a11y。
 * 用 `visibility: hidden` 而非 `display: none`：二者都不上 innerText，但前者不塌缩布局，
 * 否则正文（常是 `[user-content]` 大树）一隐一现会把窗口滚回顶部，破坏滚动相关测试。
 * 跳过 `[user-content=""]` / `[language-check-ignore]` / `[aria-hidden="true"]` / `[inert]`（`.hidden` / `[hidden]` 本就不上 innerText）。
 * `user-content="aria-label"` 只跳过 aria-label、不跳过可见文案，故不在此列。
 */
import { LOCALE_CHECK_SKIP_SELECTOR } from './locale_script.mjs'

/**
 * 收集页面可见文案（含 title）；跳过 `[user-content=""]` / `[language-check-ignore]` / `[aria-hidden="true"]` / `[inert]`。
 * @param {Document} [doc=document] 文档
 * @returns {string} 可见文案
 */
export function collectVisiblePageText(doc = document) {
	const skipped = [...doc.querySelectorAll(`${LOCALE_CHECK_SKIP_SELECTOR}, [aria-hidden="true"], [inert]`)]
	/** @type {{ value: string, priority: string }[]} */
	const prev = []
	for (const el of skipped) {
		prev.push({
			value: el.style.getPropertyValue('visibility'),
			priority: el.style.getPropertyPriority('visibility'),
		})
		el.style.setProperty('visibility', 'hidden', 'important')
	}
	try {
		return `${doc.title}\n${doc.body?.innerText ?? ''}`
	}
	finally {
		skipped.forEach((el, i) => {
			const { value, priority } = prev[i]
			if (value) el.style.setProperty('visibility', value, priority)
			else el.style.removeProperty('visibility')
		})
	}
}
