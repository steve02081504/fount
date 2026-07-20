/**
 * Chat live WebSocket 探针共用：CI 路径禁止 skip exit 0。
 */
import { console, geti18n } from '../../i18n/bare.mjs'

import { requireLiveApiKey, requireLiveBaseUrl } from './env.mjs'
import { invokeRequest, okStatus } from './http.mjs'

/**
 * live WS/HTTP 探针：shell + root API 客户端。
 * `okStatus` 随返回对象提供（定义在 `http.mjs`）；勿在本模块再 re-export。
 * @param {object} [options] 选项
 * @param {string} [options.shell='chat'] shell 名
 * @param {string} [options.base] 基址
 * @param {string} [options.key] API key
 * @param {number} [options.timeoutSec=60] 默认超时秒
 * @returns {{ base: string, key: string, shellApi: Function, chatApi: Function, rootApi: Function, okStatus: typeof okStatus }} HTTP 客户端
 */
export function createLiveShellHttp(options = {}) {
	const base = (options.base ?? requireLiveBaseUrl()).trim().replace(/\/+$/, '')
	const key = (options.key ?? requireLiveApiKey()).trim()
	const shell = options.shell ?? 'chat'
	const timeoutSec = options.timeoutSec ?? 60
	const node = { base, key }

	/**
	 * @param {string} method HTTP 方法
	 * @param {string} path shell 相对路径
	 * @param {unknown} [body] JSON 体
	 * @param {string} [keyOverride] 覆盖 API key
	 * @returns {Promise<import('./http.mjs').LiveHttpResponse>} 响应
	 */
	function shellApi(method, path, body, keyOverride) {
		const handle = keyOverride != null ? { base, key: keyOverride } : node
		return invokeRequest(handle, method, path, body, { timeoutSec, shell })
	}

	/**
	 * @param {string} method HTTP 方法
	 * @param {string} path 绝对路径
	 * @param {unknown} [body] JSON 体
	 * @returns {Promise<import('./http.mjs').LiveHttpResponse>} 响应
	 */
	function rootApi(method, path, body) {
		return invokeRequest(node, method, path, body, { timeoutSec })
	}

	return {
		base,
		key,
		shellApi,
		/** chat 脚本别名 */
		chatApi: shellApi,
		rootApi,
		okStatus,
	}
}

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
	if (!list?.length) return null
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
 * @returns {Promise<{ ok: boolean, types: string[], frames: object[] }>} 是否在超时前收到期望帧
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
		/**
		 * 结束等待并关闭连接。
		 * @param {boolean} ok 是否视为成功
		 * @returns {void}
		 */
		const finish = (ok) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			try { websocket.close() } catch { /* ok */ }
			resolve({ ok, types: [...new Set(receivedTypes)], frames })
		}
		const timeout = setTimeout(() => finish(false), timeoutMs)
		/** @returns {Promise<void>} 连接建立后执行 trigger */
		websocket.onopen = async () => {
			try {
				if (trigger) await trigger()
			}
			catch {
				finish(false)
			}
		}
		/**
		 * 解析入站帧并检查是否命中期望 type。
		 * @param {MessageEvent} event WebSocket message 事件
		 * @returns {void}
		 */
		websocket.onmessage = event => {
			const frame = JSON.parse(String(event.data))
			frames.push(frame)
			if (frame?.type) receivedTypes.push(frame.type)
			if (types.includes(frame.type)) finish(true)
		}
		/** @returns {void} 连接错误时结束等待 */
		websocket.onerror = () => finish(false)
	})
}
