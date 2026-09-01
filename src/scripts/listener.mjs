/**
 * 本地端口监听探查：查谁在听某个端口，或该端口是否在监听。
 *
 * 背景：Windows 上对刚关闭端口的 fetch 会挂满健康检查超时才返回（SYN 重试），
 * 因此「本地服务在不在」这类探活若只靠 HTTP/WS 轮询会白白等待。改用 netstat/lsof
 * 直接读 TCP 表，能在 ~100ms 内判定端口是否被监听，避免长时间轮询。
 *
 * 使用（仅 Deno/Node 环境；pwsh/sh 无法 import，见 path 侧 native 实现）：
 *   import { isPortListening } from '../scripts/listener.mjs'
 */
import { execFile as execFileCallback } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/**
 * 从 netstat -ano 行里抠 LISTENING pid。
 * @param {string} stdout netstat 输出
 * @param {number} port 端口
 * @returns {number} pid；没有则为 0
 */
export function parseNetstatListenPid(stdout, port) {
	const token = `:${port}`
	for (const line of stdout.split(/\r?\n/)) {
		if (!/listen/i.test(line) && !line.includes('侦听')) continue
		const index = line.indexOf(token)
		if (index < 0) continue
		const after = line[index + token.length]
		if (after && ![' ', '\t'].includes(after)) continue
		const pid = Number(line.trim().split(/\s+/).at(-1))
		if (pid > 0) return pid
	}
	return 0
}

/**
 * 查谁在听这个端口；没有则为 0。
 * @param {number} port 端口
 * @returns {Promise<number | null>} 监听进程 pid；无人监听为 0，探查出错为 null
 */
export async function listenerPid(port) {
	try {
		if (process.platform === 'win32')
			return parseNetstatListenPid(String((await execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true })).stdout), port)
		// macOS 自带 lsof 4.90 不支持 -Q；其余平台补上 -Q，让「无匹配监听」返回 0 而非
		// 退出码 1（否则空结果会误走下方 catch 返回 null），真实执行失败仍走 catch。
		const args = ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']
		if (process.platform !== 'darwin') args.push('-Q')
		const pid = Number(String((await execFile('lsof', args)).stdout).trim().split(/\s+/)[0])
		return pid > 0 ? pid : 0
	}
	catch {
		return null
	}
}

/**
 * 端口当前是否有进程在监听。
 * @param {number} port 端口
 * @returns {Promise<boolean | null>} 是否在监听；探查出错（无法判定）为 null
 */
export async function isPortListening(port) {
	const pid = await listenerPid(port)
	if (pid === null) return null
	return pid !== 0
}
