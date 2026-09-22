const BASE = '/api/parts/shells:code'

/**
 * @param {object} node launchNode 句柄
 * @param {string} method HTTP 方法
 * @param {string} path API 相对路径
 * @param {object} [body] JSON body
 * @returns {Promise<Response>} fetch 响应
 */
export function codeFetch(node, method, path, body) {
	const url = `${node.baseUrl}${BASE}${path}`
	return fetch(url, {
		method,
		headers: {
			...body ? { 'content-type': 'application/json' } : {},
			authorization: `Bearer ${node.apiKey}`,
		},
		body: body ? JSON.stringify(body) : undefined,
	})
}

/**
 * 经 exec WS 执行一条 shell 命令，收集流式输出帧并等待完成。
 * @param {object} node - launchNode 句柄。
 * @param {{machine: string, workdir?: string, shell?: string, command: string}} payload - 执行参数。
 * @returns {Promise<{done: object, outputs: object[]}>} done 帧与 output 帧列表。
 */
export function execStream(node, payload) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${node.baseUrl.replace(/^http/, 'ws')}/ws/parts/shells:code/exec?fount-apikey=${encodeURIComponent(node.apiKey)}`)
		const outputs = []
		const timer = setTimeout(() => { ws.close(); reject(new Error('exec ws timeout')) }, 60_000)
		/**
		 * 连接建立后发送命令。
		 * @returns {void}
		 */
		ws.onopen = () => ws.send(JSON.stringify({ id: 'exec-test', ...payload }))
		/**
		 * 收集输出帧，done/error 时结束等待。
		 * @param {MessageEvent} event - 入站消息事件。
		 * @returns {void}
		 */
		ws.onmessage = event => {
			const frame = JSON.parse(String(event.data))
			if (frame.type === 'output') outputs.push(frame)
			else if (frame.type === 'done') { clearTimeout(timer); ws.close(); resolve({ done: frame, outputs }) }
			else if (frame.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error(frame.error)) }
		}
		/**
		 * 连接错误时拒绝。
		 * @returns {void}
		 */
		ws.onerror = () => { clearTimeout(timer); reject(new Error('exec ws error')) }
	})
}

/**
 * 经会话 WS 发送一条消息，按到达顺序收集全部帧直到 done/error。
 * @param {object} node - launchNode 返回值
 * @param {object} payload - `send` / `regen` 负载
 * @returns {Promise<{done: object, frames: object[]}>} 终止帧与中间帧列表
 */
export function sessionStream(node, payload) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${node.baseUrl.replace(/^http/, 'ws')}/ws/parts/shells:code/session?fount-apikey=${encodeURIComponent(node.apiKey)}`)
		const frames = []
		const timer = setTimeout(() => { ws.close(); reject(new Error('session ws timeout')) }, 60_000)
		/**
		 * 连接建立后发送负载。
		 * @returns {void}
		 */
		ws.onopen = () => ws.send(JSON.stringify(payload))
		/**
		 * 收集中间帧；done 时结束等待。
		 * @param {MessageEvent} event - 入站消息事件。
		 * @returns {void}
		 */
		ws.onmessage = event => {
			const frame = JSON.parse(String(event.data))
			if (frame.type === 'done' || frame.type === 'error' || frame.type === 'aborted') {
				clearTimeout(timer)
				ws.close()
				resolve({ done: frame, frames })
				return
			}
			frames.push(frame)
		}
		/**
		 * 连接错误时拒绝。
		 * @returns {void}
		 */
		ws.onerror = () => { clearTimeout(timer); reject(new Error('session ws error')) }
	})
}
