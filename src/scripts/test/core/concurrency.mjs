/**
 * 测试全局资源预算：按 CPU 线程数与当前空闲内存动态估算。
 */
/* global Deno */
import { cpus, freemem } from 'node:os'
import process from 'node:process'

/** @type {{ symbols: { GlobalMemoryStatusEx: (buffer: Uint8Array) => number } } | undefined} */
let kernel32

/**
 * MEMORYSTATUSEX 的提交余量；不要读取后面的进程虚拟地址空间（通常可达 128 TiB）。
 * @param {Uint8Array} buffer Windows MEMORYSTATUSEX 结构
 * @returns {number} 剩余提交字节数
 */
export function windowsCommitAvailableBytes(buffer) {
	return Number(new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getBigUint64(32, true))
}

/**
 * 可供新任务使用的物理内存与已配置交换空间；Windows 使用提交余量，避免重复计数。
 * 不把任意空闲磁盘当作已配置的虚拟内存。探测失败回退物理内存。
 * @returns {number} 可用字节数
 */
export function availableTestMemoryBytes() {
	try {
		if (process.platform === 'win32') {
			kernel32 ??= Deno.dlopen('kernel32.dll', {
				GlobalMemoryStatusEx: { parameters: ['buffer'], result: 'i32' },
			})
			const buffer = new Uint8Array(64)
			const view = new DataView(buffer.buffer)
			view.setUint32(0, buffer.byteLength, true)
			if (!kernel32.symbols.GlobalMemoryStatusEx(buffer)) throw new Error('memory status unavailable')
			return windowsCommitAvailableBytes(buffer)
		}
		const info = Deno.systemMemoryInfo()
		return Math.max(info.available || info.free, info.free) + Math.max(0, info.swapFree)
	}
	catch {
		return freemem()
	}
}

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
 * @param {number} [availableMemBytes] 当前可用物理/虚拟内存（测试可注入）
 * @returns {GlobalBudget} 预算
 */
export function computeGlobalBudget(trackedMemBytes = 0, availableMemBytes = availableTestMemoryBytes()) {
	return { cores: Math.max(1, cpus().length), memBytes: Math.floor((availableMemBytes + trackedMemBytes) * MEM_HEADROOM) }
}
