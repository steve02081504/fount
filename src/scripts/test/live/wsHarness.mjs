/**
 * Chat live WebSocket 探针共用：CI 路径禁止 skip exit 0。
 */
import { console, geti18n } from '../../i18n/bare.mjs'

/**
 * 以通过/失败状态结束进程。
 * @param {boolean} ok 是否通过
 * @param {string} detail 结果说明
 * @returns {never} 以 0/1 退出
 */
export function finishLiveWs(ok, detail) {
	console.log(geti18n(ok ? 'fountConsole.test.ws.pass' : 'fountConsole.test.ws.fail', { detail }))
	process.exit(ok ? 0 : 1)
}

/**
 * 从角色列表选取测试用角色。
 * @param {string[] | null | undefined} list 可用角色名列表
 * @param {string[]} preferred 优先顺序
 * @returns {string|null} 匹配到的角色名
 */
export function pickPreferredChar(list, preferred) {
	for (const name of preferred)
		if (list.includes(name)) return name
	return list[0] ?? null
}

/**
 * CI live 探针：缺少前置条件时必须 fail，不能静默 skip。
 * @param {string} reason 失败原因
 * @returns {never} 以退出码 1 结束
 */
export function failLiveWsPrecondition(reason) {
	finishLiveWs(false, reason)
}

/**
 * 等待 WebSocket 帧（live 探针共用）。
 * @param {object} options 选项
 * @param {string} options.url WebSocket URL
 * @param {string[]} options.types 期望帧 type 列表（任一命中即成功）
 * @param {() => void | Promise<void>} [options.trigger] 连接后触发动作
 * @param {number} [options.timeoutMs=20000] 超时毫秒
 * @returns {Promise<{ ok: boolean, types: string[], frames: object[] }>}
 */
export function waitForWsFrame(options) {
	const {
		url,
		types,
		trigger,
		timeoutMs = 20_000,
	} = options
	return new Promise(resolve => {
		const websocket = new WebSocket(url)
		/** @type {object[]} */
		const frames = []
		/** @type {string[]} */
		const receivedTypes = []
		let settled = false
		const finish = (ok) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			try { websocket.close() } catch { /* ok */ }
			resolve({ ok, types: [...new Set(receivedTypes)], frames })
		}
		const timeout = setTimeout(() => finish(false), timeoutMs)
		websocket.onopen = async () => {
			try {
				if (trigger) await trigger()
			}
			catch {
				finish(false)
			}
		}
		websocket.onmessage = event => {
			const frame = JSON.parse(String(event.data))
			frames.push(frame)
			if (frame?.type) receivedTypes.push(frame.type)
			if (types.includes(frame.type)) finish(true)
		}
		websocket.onerror = () => finish(false)
	})
}
