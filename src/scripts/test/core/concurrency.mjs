/**
 * 测试并发度：按 CPU 线程数与当前空闲内存动态估算。
 */
import { cpus, freemem } from 'node:os'
import process from 'node:process'

const MiB = 1024 * 1024
/**
 *
 */
export { MiB }

/** unit 单文件子进程内存估算（pure ~100MB，integration headless ~300MB）。 */
export const UNIT_MEM = 250 * MiB

/** 仅使用空闲内存的比例，为 OS 与其他进程保留余量。 */
export const MEM_HEADROOM = 0.7

/** 外层下放给子进程（serial.mjs）的 CPU 预算 env。 */
export const BUDGET_CORES_ENV = 'FOUNT_TEST_BUDGET_CORES'

/** 外层下放给子进程（serial.mjs）的内存预算 env（bytes）。 */
export const BUDGET_MEM_ENV = 'FOUNT_TEST_BUDGET_MEM'

/**
 * 全局测试预算。
 * @typedef {{ cores: number, memBytes: number }} GlobalBudget
 */

/**
 * 计算全局 CPU/内存预算（供 serial.mjs 内文件并行下放）。
 * @returns {GlobalBudget} 预算
 */
export function computeGlobalBudget() {
	return { cores: cpus().length, memBytes: Math.floor(freemem() * MEM_HEADROOM) }
}

/**
 * 根据 CPU 线程数与当前空闲内存计算并发上限。
 * @param {number} memPerJob 每个并发任务预估内存（bytes）
 * @param {number} envOverride env 覆盖值（Number() 后；NaN 或 <1 走动态路径）
 * @returns {number} 建议并发数（>= 1）
 */
export function computeConcurrency(memPerJob, envOverride) {
	if (envOverride >= 1) return Math.floor(envOverride)
	const cpuBound = cpus().length
	const memBound = Math.floor(freemem() * MEM_HEADROOM / memPerJob)
	return Math.max(1, Math.min(cpuBound, memBound))
}

/**
 * 在已知预算下计算并发数。
 * @param {number} memPerJob 单任务内存（bytes）
 * @param {number} budgetCores CPU 预算
 * @param {number} budgetMem 内存预算（bytes）
 * @returns {number} 并发数（>= 1）
 */
export function concurrencyFromBudget(memPerJob, budgetCores, budgetMem) {
	const memBound = Math.floor(budgetMem / memPerJob)
	return Math.max(1, Math.min(budgetCores, memBound))
}

/**
 * 从进程 env 读取外层下放的预算；未设置时返回 null。
 * @param {NodeJS.ProcessEnv} [env=process.env] 环境变量
 * @returns {GlobalBudget | null} 预算或 null
 */
export function readBudgetFromEnv(env = process.env) {
	const cores = Number(env[BUDGET_CORES_ENV])
	const memBytes = Number(env[BUDGET_MEM_ENV])
	if (cores >= 1 && memBytes >= 1)
		return { cores: Math.floor(cores), memBytes: Math.floor(memBytes) }
	return null
}

/**
 * 将预算写入 env 对象。
 * @param {Record<string, string>} env 目标 env
 * @param {GlobalBudget} budget 预算
 * @returns {Record<string, string>} 同一 env 引用
 */
export function applyBudgetToEnv(env, budget) {
	env[BUDGET_CORES_ENV] = String(budget.cores)
	env[BUDGET_MEM_ENV] = String(budget.memBytes)
	return env
}
