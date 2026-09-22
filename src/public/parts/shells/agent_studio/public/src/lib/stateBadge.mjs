/**
 * 【文件】public/src/lib/stateBadge.mjs — 运行状态徽章样式
 * 【职责】把子代理运行状态映射为 DaisyUI 徽章类名。
 * 【原理】纯映射，供仪表盘与子代理视图共用。
 * 【关联】views/dashboard.mjs、views/subagent.mjs。
 */

/**
 * 取运行状态对应的徽章样式。
 * @param {string} runState 状态
 * @returns {string} 徽章类名
 */
export function stateBadge(runState) {
	if (runState === 'running' || runState === 'summarizing') return 'badge-info'
	if (runState === 'failed' || runState === 'terminated') return 'badge-error'
	if (runState === 'done') return 'badge-success'
	return 'badge-ghost'
}
