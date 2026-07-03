/**
 * HTTP/TCP listen 绑定选项（与 server.mjs 默认行为一致）。
 * config.listen 为 null 时双栈 ::，使 http://localhost 同时覆盖 ::1 与 127.0.0.1。
 */

/**
 * @param {string | null | undefined} host config.listen
 * @param {number} port 端口
 * @returns {import('node:net').ListenOptions} listen 绑定
 */
export function resolveListenBind(host, port) {
	if (host == null) return { port, host: '::', ipv6Only: false }
	return { port, host }
}
