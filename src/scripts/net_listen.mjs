/**
 * HTTP/TCP listen 绑定选项。
 *
 * Deno 在 Windows 上对 `ipv6Only: false` 的双栈 `::` 无效（与 Node 不同），
 * 须显式双绑 `0.0.0.0` + `::`（ipv6Only）。
 * Linux/macOS 上 `::` + ipv6Only:false 一口吃 IPv4-mapped；若再绑 `0.0.0.0` 会 EADDRINUSE。
 */
import net from 'node:net'
import process from 'node:process'

/** Windows Deno 无法靠单绑 `::` 覆盖 IPv4。 */
const explicitDualStack = process.platform === 'win32'

/**
 * @param {string | null | undefined} host config.listen
 * @param {number} port 端口
 * @returns {import('node:net').ListenOptions[]} 需全部尝试的绑定（某族不可用则跳过）
 */
export function resolveListenBinds(host, port) {
	if (host == null) {
		if (explicitDualStack) return [
			{ port, host: '0.0.0.0' },
			{ port, host: '::', ipv6Only: true },
		]
		return [{ port, host: '::', ipv6Only: false }]
	}
	if (host === 'localhost') return [
		{ port, host: '127.0.0.1' },
		{ port, host: '::1', ipv6Only: true },
	]
	return [{ port, host }]
}

/**
 * 单绑兼容（取列表首项）。新代码请用 {@link resolveListenBinds}。
 * @param {string | null | undefined} host config.listen
 * @param {number} port 端口
 * @returns {import('node:net').ListenOptions} listen 绑定
 */
export function resolveListenBind(host, port) {
	return resolveListenBinds(host, port)[0]
}

/**
 * 是否仅 loopback 范围（不打印局域网 URL / 二维码）。
 * @param {string | null | undefined} host config.listen
 * @returns {boolean} host 为 localhost 时为 true
 */
export function isLoopbackListen(host) {
	return host === 'localhost'
}

/**
 * 尝试绑定一次；族不支持视为可跳过。
 * @param {import('node:net').ListenOptions} bind 绑定选项
 * @returns {Promise<'ok' | 'busy' | 'unsupported'>} 探测结果
 */
function probeBind(bind) {
	return new Promise(resolve => {
		const server = net.createServer()
		server.unref()
		server.once('error', err => {
			if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(err.code)) resolve('unsupported')
			else resolve('busy')
		})
		server.listen(bind, () => {
			server.close(() => resolve('ok'))
		})
	})
}

/**
 * 监听一次；族不支持返回 null。
 * @param {import('node:net').ListenOptions} bind 绑定选项
 * @returns {Promise<import('node:net').Server | null>} 已监听 server，或不支持时 null
 */
function listenOne(bind) {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.unref()
		server.once('error', err => {
			if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(err.code)) resolve(null)
			else reject(err)
		})
		server.listen(bind, () => resolve(server))
	})
}

/**
 * 检测默认双栈（或指定 host）下该端口是否可完整占用。
 * 任一所需族 EADDRINUSE → false；全部族不支持 → false；至少一族 ok 且无 busy → true。
 * @param {number} port 待检测端口
 * @param {string | null | undefined} [host] config.listen；默认 null（双栈 any）
 * @returns {Promise<boolean>} 端口是否空闲可用
 */
export async function isListenPortFree(port, host = null) {
	let sawOk = false
	for (const bind of resolveListenBinds(host, port)) {
		const result = await probeBind(bind)
		if (result === 'busy') return false
		if (result === 'ok') sawOk = true
	}
	return sawOk
}

/**
 * 占住默认双栈端口直至显式关闭（消除并行测试 TOCTOU）。
 * @param {number} port 待占用端口
 * @param {string | null | undefined} [host] config.listen；默认 null（双栈 any）
 * @returns {Promise<import('node:net').Server[]>} 已监听的 server 列表
 */
export async function holdListenPort(port, host = null) {
	/** @type {import('node:net').Server[]} */
	const held = []
	try {
		for (const bind of resolveListenBinds(host, port)) {
			const server = await listenOne(bind)
			if (server) held.push(server)
		}
		if (!held.length) throw new Error(`no supported listen family for port ${port}`)
		return held
	}
	catch (err) {
		await Promise.all(held.map(s => new Promise(r => s.close(() => r()))))
		throw err
	}
}

/**
 * 关闭 {@link holdListenPort} 返回的 server 列表。
 * @param {import('node:net').Server[] | undefined} servers 待关闭的 server 列表
 * @returns {Promise<void>} 全部关闭后兑现
 */
export async function closeHeldServers(servers) {
	if (!servers?.length) return
	await Promise.all(servers.map(s => new Promise((resolve, reject) => {
		s.close(err => err ? reject(err) : resolve())
	})))
}
