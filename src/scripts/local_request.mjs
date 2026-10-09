/** 转发标记：带上它们的连接即便来自回环也只算远端，绝不因此获得本机权限。 */
const FORWARDING_HEADERS = new Set([
	'forwarded', 'via', 'x-real-ip', 'cf-connecting-ip', 'cf-connecting-ipv6', 'cf-ray', 'true-client-ip',
])

/**
 * 判断 Host 是否为回环地址；拒绝缺失、多值及不合法的 authority。
 * @param {string} host Host 头。
 * @returns {boolean} 是否回环主机。
 */
function isLoopbackHost(host) {
	if (/[\s,/@?#\\]/u.test(host)) return false
	try {
		return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname)
	}
	catch { return false }
}

/**
 * 是否只有直接本机请求才算本地。HTTP 与 WebSocket 共用原始 socket 与请求头：
 * 转发头（或非回环 Host）只取消本机资格，绝不授予本机权限。
 * @param {import('npm:express').Request} req 请求。
 * @param {(ip: string) => boolean} isLocalIP 本机地址判断。
 * @returns {boolean} 是否直接本机请求。
 */
export function is_direct_local_request(req, isLocalIP) {
	// 只有原始 Host 才算数：代理提供的 hostname 可以随便声称自己是 localhost。
	if (!isLocalIP(req.socket?.remoteAddress) || !isLoopbackHost(req.headers?.host)) return false
	if (req.ip && !isLocalIP(req.ip)) return false
	return !Object.keys(req.headers).some(name => {
		const header = name.toLowerCase()
		return FORWARDING_HEADERS.has(header) || header.startsWith('x-forwarded-')
	})
}

/**
 * 直接本机请求还必须有本机 Origin，或无 Origin 的 CLI 请求。
 * @param {import('npm:express').Request} req 请求。
 * @param {(ip: string) => boolean} isLocalIP 本机地址判断。
 * @returns {boolean} 是否可信本机请求。
 */
export function is_trusted_direct_local_request(req, isLocalIP) {
	if (!is_direct_local_request(req, isLocalIP)) return false
	const origin = req.headers?.origin
	if (!origin) return true
	try { return isLoopbackHost(new URL(origin).host) }
	catch { return false }
}
