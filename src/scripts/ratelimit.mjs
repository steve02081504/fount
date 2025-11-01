import dns from 'node:dns'

import { config } from '../server/server.mjs'

import { in_docker } from './env.mjs'
import { ms } from './ms.mjs'

const localIPs = [
	'127.0.0.1', '::1',
	in_docker ? await dns.promises.lookup('host.docker.internal').then(r => r.address) : null
].filter(Boolean)

/**
 * 检查给定的 IP 地址是否为本地 IP。
 * @param {string} ip - 要检查的 IP 地址。
 * @returns {boolean} 如果 IP 地址是本地 IP，则返回 true，否则返回 false。
 */
export function is_local_ip(ip) {
	return localIPs.includes(ip)
}

/**
 * 检查请求是否来自本地 IP。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {boolean} 如果请求来自本地 IP，则返回 true，否则返回 false。
 */
export function is_local_ip_from_req(req) {
	return is_local_ip(req.ip)
}

/* global Deno */
/**
 * 获取本地 IP 地址。
 * @returns {string|undefined} 本地 IP 地址，如果找不到则返回 undefined。
 */
export function get_local_ip() {
	const interfaces = Deno.networkInterfaces()
	return (
		interfaces.find(i => i.family == 'IPv4' && i.name == 'WLAN') ||
		interfaces.find(i => i.family == 'IPv4' && i.name == 'eth0') ||
		interfaces.find(i => i.family == 'IPv4') ||
		0)?.address
}

/**
 * 获取本地 IP 的主机 URL。
 * @returns {string} 本地 IP 的主机 URL。
 */
export function get_hosturl_in_local_ip() {
	const is_https = config.https?.enabled
	return `http${is_https ? 's' : ''}://${get_local_ip()}:${config.port}`
}

/**
 * 生成一个速率限制中间件。
 * @param {object} options 配置选项
 * @param {number} options.maxRequests 最大请求次数
 * @param {string|number} options.windowMs 时间窗口（例如：'1m', '1h'）
 * @param {boolean} [options.byIP=true] 是否基于 IP 地址限制（默认为 true）
 * @param {boolean} [options.byUsername=false] 是否基于用户名限制（如果提供，优先级高于 IP）
 * @param {string} [options.message='Too many requests'] 超出限制时的消息
 * @returns {import('npm:express').RequestHandler} Express 中间件
 */
export function rateLimit(options) {
	const {
		maxRequests,
		windowMs,
		byIP = true,
		byUsername = false,
		message = 'Too many requests',
	} = options

	const requestCounts = new Map() // 使用 Map 存储请求计数

	return (req, res, next) => {
		if (byIP && is_local_ip(req.ip)) return next()
		const key = byUsername && req.body.username ? req.body.username : byIP ? req.ip : null

		if (!key) return res.status(401).json({ message: 'Unauthorized' })

		const now = Date.now()
		for (const [k, entry] of requestCounts)
			if (entry.expiry < now)
				requestCounts.delete(k)

		const windowMsNumber = ms(windowMs)
		if (!requestCounts.has(key))
			requestCounts.set(key, { count: 0, expiry: now + windowMsNumber })

		const entry = requestCounts.get(key)
		entry.count++

		if (entry.count > maxRequests) return res.status(429).json({ message })
		return next()
	}
}
