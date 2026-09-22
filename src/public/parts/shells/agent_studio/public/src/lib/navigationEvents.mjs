/**
 * 【文件】public/src/lib/navigationEvents.mjs — 跨视图导航请求事件
 * 【职责】提供解耦的导航请求通道，避免视图静态依赖 `navigation.mjs` 造成循环引用。
 * 【原理】视图派发自定义事件，导航层监听后执行切换。
 * 【关联】navigation.mjs、views/subagent.mjs。
 */

/** 跨视图导航请求事件名。 */
export const NAVIGATE_EVENT = 'agent-studio:navigate'

/**
 * 请求切换到某个主视图（由导航层监听执行）。
 * @param {string} view 视图名
 * @returns {void}
 */
export function requestNavigate(view) {
	window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view } }))
}
