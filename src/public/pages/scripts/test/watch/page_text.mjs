/**
 * 可见 UI 文案提取：临时隐藏 `[user-content]` 后读 title + body.innerText。
 * 调用方负责套 MutationGate，避免隐藏操作喂脏 a11y。
 */

/**
 * 收集页面可见文案（含 title）；跳过 `[user-content]`。
 * @returns {string} 可见文案
 */
export function collectVisiblePageText() {
	const skipped = [...document.querySelectorAll('[user-content]')]
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
		return `${document.title}\n${document.body?.innerText ?? ''}`
	}
	finally {
		skipped.forEach((el, i) => {
			const { value, priority } = prev[i]
			if (value) el.style.setProperty('display', value, priority)
			else el.style.removeProperty('display')
		})
	}
}
