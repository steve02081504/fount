/**
 * 【文件】public/src/data.mjs — Agent Studio 共享数据加载
 * 【职责】从端点加载角色、基准与保留策略，并写入 `state`；供启动与全局刷新复用。
 * 【原理】命名导出的小函数，每个对应一类共享数据。
 * 【关联】endpoints.mjs、state.mjs、index.mjs。
 */
import { getRetention, listBenchmarks, listChars } from './endpoints.mjs'
import { state } from './state.mjs'

/**
 * 加载角色列表并写入共享状态。
 * @returns {Promise<object[]>} 角色列表
 */
export async function reloadChars() {
	state.chars = await listChars()
	return state.chars
}

/**
 * 加载基准定义并写入共享状态。
 * @returns {Promise<object[]>} 基准列表
 */
export async function reloadBenchmarks() {
	state.benchmarks = await listBenchmarks()
	return state.benchmarks
}

/**
 * 加载保留策略并写入共享状态。
 * @returns {Promise<object>} 保留策略
 */
export async function reloadRetention() {
	state.retention = await getRetention()
	return state.retention
}
