import { createExposureDetector, exposureResponse, PROXY_EXPOSURE_PAGE } from './proxy_exposure.mjs'

/** 公网接入的唯一判定实现；缓存与 DNS 去重靠它的闭包，不能每次调用新建。 */
const detectExposure = createExposureDetector()

/**
 * @param {object} socket 连接。
 * @param {Function} [done] 写完后的回调。
 * @returns {void}
 */
function rejectUpgrade(socket, done) {
	// 停用后没有可升级的服务：固定 500 空响应，提示页只服务 HTTP。
	socket.end('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', done)
}

/**
 * 一次触发，停用全部原始监听器并在相同绑定上启动独立提示服务器。
 * @param {object} options 依赖。
 * @param {Function} options.createServer 创建保持原 HTTP(S) 协议的服务器。
 * @param {Function} options.report 报告停用与启动失败。
 * @param {Function} [options.detect] 检测请求。
 * @returns {object} 原服务器注册器与请求拦截器。
 */
export function createProxyExposureGuard({ createServer, report, detect = detectExposure }) {
	const entries = []
	let blocked = false
	let replacement
	/**
	 * @param {object} entry 原监听器与绑定信息。
	 * @param {object} entry.server 原服务器。
	 * @param {object} entry.bind 监听绑定。
	 * @param {Set} entry.sockets 已有连接。
	 * @returns {Promise<void>} 替换完成。
	 */
	async function replaceEntry({ server, bind, sockets }) {
		// close 停止 accept；主动断开已有 WS 和 keep-alive，触发响应先发完。
		await new Promise((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve())
			for (const socket of sockets) socket.destroy()
		})
		const notice = createServer(exposureResponse)
		notice.on('upgrade', (_req, socket) => rejectUpgrade(socket))
		await new Promise((resolve, reject) => {
			notice.once('error', reject)
			notice.listen(bind, resolve)
		})
		notice.on('error', report)
	}
	/**
	 * @param {object} req 请求。
	 * @returns {Promise<boolean>} 是否停用。
	 */
	async function check(req) {
		if (blocked) return true
		blocked = await detect(req)
		if (!blocked) return false
		report(new Error(`Web service disabled: public Host without forwarding headers. Fix the proxy configuration, then restart fount. ${PROXY_EXPOSURE_PAGE}`))
		return true
	}
	/**
	 * 响应发完后执行一次替换。
	 * @returns {void}
	 */
	function startReplacement() {
		replacement ??= Promise.all(entries.map(replaceEntry)).catch(report)
	}
	return {
		/**
		 * @param {object} server 原服务器。
		 * @param {object} bind 绑定。
		 * @returns {void}
		 */
		register(server, bind) {
			const sockets = new Set()
			server.on('connection', socket => {
				sockets.add(socket)
				socket.once('close', () => sockets.delete(socket))
			})
			const entry = { server, bind: { ...bind, port: server.address().port }, sockets }
			entries.push(entry)
			// 双栈启动期间也可能收到请求；后绑定成功的监听器同样必须停用。
			if (replacement) replacement = replacement.then(() => replaceEntry(entry)).catch(report)
		},
		/**
		 * @param {object} req 请求。
		 * @param {object} res 响应。
		 * @returns {Promise<boolean>} 是否拦截。
		 */
		async http(req, res) {
			if (!await check(req)) return false
			if (req.socket.destroyed) {
				startReplacement()
				return true
			}
			res.once('finish', startReplacement)
			res.once('close', startReplacement)
			exposureResponse(req, res)
			return true
		},
		/**
		 * @param {object} req 请求。
		 * @param {object} socket 连接。
		 * @returns {Promise<boolean>} 是否拦截。
		 */
		async upgrade(req, socket) {
			if (!await check(req)) return false
			if (socket.destroyed) {
				startReplacement()
				return true
			}
			socket.once('close', startReplacement)
			rejectUpgrade(socket, startReplacement)
			return true
		},
		/** @returns {Promise<void> | undefined} 提示服务器启动。 */
		get replacement() { return replacement },
	}
}
