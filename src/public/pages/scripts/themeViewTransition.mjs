/**
 * 主题切换的 View Transition 动画逻辑（圆圈扩散）与主题选择器「自动」预览创建。
 */

import { renderTemplate } from './template.mjs'

{
	const vt_style = document.createElement('style')
	vt_style.textContent = /* css */ `\
/* View Transition API：从点击处圆圈扩散，圈内为新主题内容。圆心由 JS 设 --theme-vt-x / --theme-vt-y */
@keyframes theme-vt-circle-out {
	from {
		clip-path: circle(150vmax at var(--theme-vt-x, 50%) var(--theme-vt-y, 50%));
	}
	to {
		clip-path: circle(0 at var(--theme-vt-x, 50%) var(--theme-vt-y, 50%));
	}
}

@keyframes theme-vt-circle-in {
	from {
		clip-path: circle(0 at var(--theme-vt-x, 50%) var(--theme-vt-y, 50%));
	}
	to {
		clip-path: circle(150vmax at var(--theme-vt-x, 50%) var(--theme-vt-y, 50%));
	}
}

html:active-view-transition-type(theme-switch)::view-transition-old(root) {
	animation: 0.6s cubic-bezier(0.4, 0, 0.2, 1) both theme-vt-circle-out;
}

html:active-view-transition-type(theme-switch)::view-transition-new(root) {
	animation: 0.6s cubic-bezier(0.4, 0, 0.2, 1) both theme-vt-circle-in;
}
`
	document.head.prepend(vt_style)
}

/**
 * 使用 View Transition API 从点击处圆圈扩散执行主题切换。
 * @param {MouseEvent|null} e - 点击事件（用于圆心坐标）；无则用视口中心。
 * @param {() => Promise<void>|void} update - 实际切换主题的异步回调。
 * @returns {Promise<void>}
 */
export async function applyThemeWithViewTransition(e, update) {
	const view = document.defaultView
	const w = view?.innerWidth ?? 800
	const h = view?.innerHeight ?? 600
	const x = e != null ? (e.clientX / w) * 100 : 50
	const y = e != null ? (e.clientY / h) * 100 : 50
	document.documentElement.style.setProperty('--theme-vt-x', `${x}%`)
	document.documentElement.style.setProperty('--theme-vt-y', `${y}%`)

	/**
	 * 执行更新。
	 */
	const run = async () => {
		await update?.() || update
	}

	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	if (document.startViewTransition && !prefersReducedMotion) {
		const t = document.startViewTransition({ update: run, types: ['theme-switch'] })
		await t.finished
	} else await run()
}

/**
 * 创建「自动」主题预览卡片（亮/暗各占一半）。
 * @returns {Promise<HTMLElement>} 自动主题预览卡片的 DOM 元素。
 */
export async function createAutoPreview() {
	const container = document.createElement('div')
	container.classList.add('theme-preview-card', 'cursor-pointer', 'auto-theme-container')
	container.dataset.theme = 'auto'

	const darkHalf = await renderTemplate('theme_preview', { theme: 'dark', name: 'auto', isCustom: false })
	const lightHalf = await renderTemplate('theme_preview', { theme: 'light', name: 'auto', isCustom: false })

	darkHalf.classList.add('auto-theme-half', 'auto-theme-dark')
	lightHalf.classList.add('auto-theme-half', 'auto-theme-light')

	container.append(lightHalf, darkHalf)
	return container
}
