/**
 * 测试全局资源预算：按 CPU 线程数与当前空闲内存动态估算。
 */
import { cpus, freemem } from 'node:os'

/** 二进制兆字节（1024×1024）。 */
export const MiB = 1024 * 1024

/** 仅使用空闲内存的比例，为 OS 与其他进程保留余量。 */
export const MEM_HEADROOM = 0.7

/**
 * 全局测试预算。
 * @typedef {{ cores: number, memBytes: number }} GlobalBudget
 */

/**
 * 计算全局 CPU/内存预算（内核资源闸门与单元池共用）。
 * @param {number} [trackedMemBytes=0] 已在跟踪的运行 suite 占用：它已被 freemem 扣除，加回后预算才不随 suite 起跑而塌缩。
 * @returns {GlobalBudget} 预算
 */
export function computeGlobalBudget(trackedMemBytes = 0) {
	return { cores: cpus().length, memBytes: Math.floor((freemem() + trackedMemBytes) * MEM_HEADROOM) }
}
