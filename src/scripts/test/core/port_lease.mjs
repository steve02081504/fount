/**
 * 跨进程测试端口租约：盖住 hold→release→spawn 窗口，避免并行 suite 互抢同一空闲口。
 *
 * listen hold 在 spawn 前必须释放；租约文件留到子进程 listen 就绪后再删。
 */
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { testDataRoot } from './paths.mjs'
import { REPO_ROOT } from './repo_root.mjs'

/**
 * @typedef {object} PortLease
 * @property {number} port 租约端口
 * @property {() => Promise<void>} release 释放租约（可重复调用）
 */

/** @type {Map<number, PortLease>} */
const localLeases = new Map()

/**
 * 租约目录（随 data/test/tmp 在 CI cache 前清理）。
 * @returns {string} 绝对路径
 */
function leaseDir() {
	return join(testDataRoot(REPO_ROOT), 'tmp', 'port_leases')
}

/**
 * @param {number} port 端口
 * @returns {string} 租约文件路径
 */
function leasePath(port) {
	return join(leaseDir(), `${port}.lease`)
}

/**
 * @param {number} pid 进程号
 * @returns {boolean} 进程是否仍存活
 */
function isPidAlive(pid) {
	if (!Number.isFinite(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	}
	catch {
		return false
	}
}

/**
 * 若租约文件指向已死进程则删除，便于回收崩溃残留。
 * @param {string} path 租约路径
 * @returns {Promise<boolean>} 是否已清除陈旧租约
 */
async function clearStaleLease(path) {
	let raw
	try {
		raw = await readFile(path, 'utf8')
	}
	catch (error) {
		if (error?.code === 'ENOENT') return false
		throw error
	}
	const pid = Number(String(raw).trim().split(/\r?\n/, 1)[0])
	if (isPidAlive(pid)) return false
	try {
		await unlink(path)
		return true
	}
	catch (error) {
		if (error?.code === 'ENOENT') return true
		throw error
	}
}

/**
 * 尝试取得端口的跨进程排他租约（`wx` 创建租约文件）。
 * @param {number} port 端口
 * @returns {Promise<PortLease | null>} 成功则返回句柄；已被占用返回 null
 */
export async function tryAcquirePortLease(port) {
	const existing = localLeases.get(port)
	if (existing) return existing

	const dir = leaseDir()
	await mkdir(dir, { recursive: true })
	const path = leasePath(port)

	for (let attempt = 0; attempt < 2; attempt++) {
		let handle
		try {
			handle = await open(path, 'wx')
		}
		catch (error) {
			if (error?.code !== 'EEXIST') throw error
			if (attempt === 0 && await clearStaleLease(path)) continue
			return null
		}
		try {
			await handle.writeFile(`${process.pid}\n${Date.now()}\n`, 'utf8')
		}
		finally {
			await handle.close().catch(() => {})
		}

		let released = false
		/** @type {PortLease} */
		const lease = {
			port,
			/**
			 * 释放本端口租约。
			 * @returns {Promise<void>}
			 */
			async release() {
				if (released) return
				released = true
				if (localLeases.get(port) === lease) localLeases.delete(port)
				try {
					await unlink(path)
				}
				catch (error) {
					if (error?.code !== 'ENOENT') throw error
				}
			},
		}
		localLeases.set(port, lease)
		return lease
	}
	return null
}

/**
 * 释放本进程持有的端口租约（无租约时为空操作）。
 * @param {number} port 端口
 * @returns {Promise<void>}
 */
export async function releasePortLease(port) {
	const lease = localLeases.get(port)
	if (!lease) return
	await lease.release()
}
