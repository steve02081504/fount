/**
 * PoW (Proof of Work) 挑战系统
 * 用于防止垃圾消息和 DDoS 攻击
 */

/**
 * 生成 PoW 挑战
 * @param {number} difficulty - 难度（前导零的数量）
 * @returns {object}
 */
export function generateChallenge(difficulty = 4) {
	const challenge = crypto.randomUUID()
	return {
		challenge,
		difficulty,
		timestamp: Date.now()
	}
}

/**
 * 解决 PoW 挑战
 * @param {string} challenge - 挑战字符串
 * @param {number} difficulty - 难度
 * @returns {Promise<object>}
 */
export async function solveChallenge(challenge, difficulty) {
	let nonce = 0
	const target = '0'.repeat(difficulty)

	while (true) {
		const input = `${challenge}:${nonce}`
		const hash = await hashString(input)

		if (hash.startsWith(target)) {
			return {
				nonce,
				hash
			}
		}

		nonce++

		// 防止阻塞，每 1000 次迭代让出控制权
		if (nonce % 1000 === 0) {
			await new Promise(resolve => setTimeout(resolve, 0))
		}
	}
}

/**
 * 验证 PoW 解决方案
 * @param {string} challenge - 挑战字符串
 * @param {number} nonce - 随机数
 * @param {number} difficulty - 难度
 * @returns {Promise<boolean>}
 */
export async function verifyChallenge(challenge, nonce, difficulty) {
	const input = `${challenge}:${nonce}`
	const hash = await hashString(input)
	const target = '0'.repeat(difficulty)

	return hash.startsWith(target)
}

/**
 * 计算字符串哈希
 * @param {string} input - 输入字符串
 * @returns {Promise<string>}
 */
async function hashString(input) {
	const encoder = new TextEncoder()
	const data = encoder.encode(input)
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * IP 限流器
 */
export class RateLimiter {
	constructor(config = {}) {
		this.maxRequestsPerMinute = config.maxRequestsPerMinute || 60
		this.maxRequestsPerHour = config.maxRequestsPerHour || 1000
		this.requests = new Map() // ip -> [{timestamp}]
	}

	/**
	 * 检查是否允许请求
	 * @param {string} ip - IP 地址
	 * @returns {boolean}
	 */
	checkLimit(ip) {
		const now = Date.now()
		const oneMinuteAgo = now - 60 * 1000
		const oneHourAgo = now - 60 * 60 * 1000

		if (!this.requests.has(ip)) {
			this.requests.set(ip, [])
		}

		const ipRequests = this.requests.get(ip)

		// 清理过期记录
		const validRequests = ipRequests.filter(t => t > oneHourAgo)
		this.requests.set(ip, validRequests)

		// 检查分钟限制
		const recentRequests = validRequests.filter(t => t > oneMinuteAgo)
		if (recentRequests.length >= this.maxRequestsPerMinute) {
			return false
		}

		// 检查小时限制
		if (validRequests.length >= this.maxRequestsPerHour) {
			return false
		}

		// 记录本次请求
		validRequests.push(now)
		this.requests.set(ip, validRequests)

		return true
	}

	/**
	 * 清理过期记录
	 */
	cleanup() {
		const oneHourAgo = Date.now() - 60 * 60 * 1000

		for (const [ip, requests] of this.requests.entries()) {
			const validRequests = requests.filter(t => t > oneHourAgo)
			if (validRequests.length === 0) {
				this.requests.delete(ip)
			} else {
				this.requests.set(ip, validRequests)
			}
		}
	}

	/**
	 * 获取剩余配额
	 * @param {string} ip - IP 地址
	 * @returns {object}
	 */
	getQuota(ip) {
		const now = Date.now()
		const oneMinuteAgo = now - 60 * 1000
		const oneHourAgo = now - 60 * 60 * 1000

		if (!this.requests.has(ip)) {
			return {
				perMinute: this.maxRequestsPerMinute,
				perHour: this.maxRequestsPerHour
			}
		}

		const ipRequests = this.requests.get(ip)
		const recentRequests = ipRequests.filter(t => t > oneMinuteAgo).length
		const hourlyRequests = ipRequests.filter(t => t > oneHourAgo).length

		return {
			perMinute: this.maxRequestsPerMinute - recentRequests,
			perHour: this.maxRequestsPerHour - hourlyRequests
		}
	}
}

/**
 * 启动定期清理
 * @param {RateLimiter} limiter - 限流器实例
 * @returns {number} 定时器ID
 */
export function startCleanup(limiter) {
	return setInterval(() => {
		limiter.cleanup()
	}, 5 * 60 * 1000) // 每 5 分钟清理一次
}
