import { ms } from './ms.mjs'

export function is_local_ip(ip) {
	const localIPs = ['127.0.0.1', '::1']
	return localIPs.includes(ip)
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
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
		if (byIP && is_local_ip(ip)) return next()
		const key = byUsername && req.body.username ? req.body.username : byIP ? ip : null

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
