/**
 * 子进程自建测试数据目录的回收清单。
 *
 * 子进程把自建的 `fount_node_*` / `fount_test_*` / `fount_tg_*` 数据目录写进本清单，
 * 由存活的父进程（suite 运行器 / `serial.mjs`）统一回收：`deno test` 子进程不运行
 * node exit 钩子（denoland/deno#36670），被 watchdog 杀死时更不会走自己的清理。
 */
import { readFileSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assertDisposableDataPath } from './disposable_path.mjs'

/**
 * 为一个子进程分配独占的回收清单路径（临时目录，带随机后缀避免并发冲撞）。
 * @param {string} [label] 归属标记，便于排查残留清单
 * @returns {string} 回收清单绝对路径
 */
export function allocateDataDirRegistryPath(label = 'fount_data_dirs') {
	const suffix = Math.random().toString(36).slice(2, 8)
	return join(tmpdir(), `${label}_${process.pid}_${suffix}.tmp`)
}

/**
 * 回收清单中登记的数据目录，并删除清单本身。
 *
 * 缺路径、读不到或删除失败都不抛错：清不掉的东西留给内核的 Temp 残留检查报出。
 * 删除有界重试，因为 Windows 上子进程刚退出时句柄与杀软锁释放有延迟。
 * @param {string} registryPath 回收清单绝对路径
 * @returns {Promise<void>}
 */
export async function reclaimDataDirs(registryPath) {
	if (!registryPath) return
	try {
		for (const line of readFileSync(registryPath, 'utf8').split('\n')) {
			const dataDir = line.trim()
			if (!dataDir) continue
			assertDisposableDataPath(dataDir)
			await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
		}
	}
	catch { /* 清不掉的残留由内核 cleanup 检查报出 */ }
	try { rmSync(registryPath, { force: true }) }
	catch { /* 清单本身删不掉不影响判定 */ }
}
