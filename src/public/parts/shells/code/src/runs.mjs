/**
 * code shell 生成运行共享叶子：运行表 / 唤醒调度 / 跨模块请求启动生成。
 * endpoints.mjs 与 request.mjs 都依赖本模块，使过期的请求对象无需反向 import endpoints.mjs 即可请求一次唤醒。
 * 运行对象字段：`runId` / `controller` / `sockets`（观察本运行的全部连接，Set<WebSocket>）/ `broadcast`（向这些连接广播一帧）
 * / `finished` / `completed` / `markInterrupted` / `wakeHeld`（本运行是否持有一份唤醒调度槽）
 * / `superseded`（是否已被更新的运行取代）/ `requestSession` / `allNewEntries`。
 * @typedef {object} codeRun_t
 */
import { createWakeScheduler } from '../../chat/src/reply/wakeScheduler.mjs'

/**
 * 生成运行键（用户 + 会话）。
 * @param {string} username - 用户名。
 * @param {string} sessionId - 会话 id。
 * @returns {string} 键。
 */
export function codeRunKey(username, sessionId) {
	return username + '\u0000' + sessionId
}

/** 进行中的生成运行：`username\0sessionId` → `codeRun_t`。 @type {Map<string, codeRun_t>} */
export const activeCodeRuns = new Map()

/** 会话级唤醒调度器（code shell 单例；`Update({ forRound: true })` 观察、运行结束 release 补触发）。 */
export const codeWakes = createWakeScheduler()

/** 由 endpoints.mjs 注册的运行启动器。 @type {((args: object) => Promise<void>) | null} */
let codeRunStarter = null

/**
 * 注册运行启动器（endpoints 在 setEndpoints 时注入，避免模块循环）。
 * @param {(args: object) => Promise<void>} fn - 启动器。
 * @returns {void}
 */
export function setCodeRunStarter(fn) {
	codeRunStarter = fn
}

/**
 * 请求在本会话至少再看一次权威日志：空闲时启动一次后端生成，生成中则标记唤醒待运行中的轮次/收尾补触发。
 * 不等待生成结束，调度完成即返回。
 * @param {{username: string, sessionId: string, machine?: string, workdir?: string, ai_source?: string, profile?: string}} args - 启动参数。
 * @returns {Promise<void>}
 */
export async function requestCodeRunStart({ username, sessionId, machine, workdir, ai_source, profile }) {
	const key = codeRunKey(username, sessionId)
	if (codeWakes.isRunning(key)) {
		codeWakes.mark(key)
		return
	}
	if (!codeRunStarter) return
	await codeRunStarter({ username, sessionId, machine, workdir, ai_source, profile })
}
