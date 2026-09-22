/**
 * 【文件】public/src/state.mjs — Agent Studio 前端共享状态
 * 【职责】保存跨视图共享的轻量状态：角色列表、保留策略、基准列表与各视图选中项。
 * 【原理】普通对象，无响应式；视图在加载后自行读取并渲染。
 * 【关联】data.mjs、views/*。
 */

/** 共享状态。 */
export const state = {
	/** @type {Array<{ id: string, info: object | null, supportedInterfaces?: string[] }>} 角色列表 */
	chars: [],
	/** @type {{ promptMs?: number, conversationMs?: number }} 保留策略 */
	retention: {},
	/** @type {object[]} 基准定义列表 */
	benchmarks: [],
	/** @type {string | null} 仪表盘当前选中角色 */
	activeCharId: null,
	/** @type {string | null} 基准页当前选中基准 */
	activeBenchmarkId: null,
}
