/**
 * 测试并发度：按 CPU 线程数与当前空闲内存动态估算。
 */
import { cpus, freemem } from 'node:os'

const MiB = 1024 * 1024
const GiB = 1024 * MiB

/** unit 单文件子进程内存估算（pure ~100MB，integration headless ~300MB）。 */
export const UNIT_MEM = 250 * MiB

/** suite 子进程内存估算（联邦双节点最重 ~1.6GB）。 */
export const SUITE_MEM = 1.5 * GiB

/** 仅使用空闲内存的比例，为 OS 与其他进程保留余量。 */
const MEM_HEADROOM = 0.7

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
