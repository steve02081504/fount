import Cap from 'npm:@cap.js/server'

import { ms } from './ms.mjs'

const data = {
	challenges: {},
	tokens: {},
}

/**
 * 工作量证明实例。
 * @type {Cap}
 */
export const pow = new Cap({
	storage: {
		challenges: {
			/**
			 * 存储质询数据。
			 * @param {string} token - 质询令牌。
			 * @param {object} challengeData - 要存储的质询数据。
			 */
			store: async (token, challengeData) => {
				data.challenges[token] = challengeData
			},
			/**
			 * 读取质询数据。
			 * @param {string} token - 质询令牌。
			 * @returns {Promise<object|null>} 质询数据，如果不存在或已过期则返回 null。
			 */
			read: async (token) => {
				const pow = data.challenges[token]
				if (pow?.expires > Date.now()) return pow
				return null
			},
			/**
			 * 删除质询数据。
			 * @param {string} token - 质询令牌。
			 */
			delete: async (token) => {
				delete data.challenges[token]
			},
			/**
			 * 删除过期的质询数据。
			 */
			deleteExpired: async () => {
				const now = Date.now()
				data.challenges = Object.fromEntries(
					Object.entries(data.challenges).filter(([, data]) => data.expires > now),
				)
			},
		},
		tokens: {
			/**
			 * 存储令牌。
			 * @param {string} tokenKey - 令牌密钥。
			 * @param {number} expires - 令牌的过期时间戳。
			 */
			store: async (tokenKey, expires) => {
				data.tokens[tokenKey] = { expires }
			},
			/**
			 * 获取令牌。
			 * @param {string} tokenKey - 令牌密钥。
			 * @returns {Promise<number|null>} 令牌的过期时间戳，如果不存在或已过期则返回 null。
			 */
			get: async (tokenKey) => {
				const token = data.tokens[tokenKey]
				if (token?.expires > Date.now()) return token.expires
				return null
			},
			/**
			 * 删除令牌。
			 * @param {string} tokenKey - 令牌密钥。
			 */
			delete: async (tokenKey) => {
				delete data.tokens[tokenKey]
			},
			/**
			 * 删除过期的令牌。
			 */
			deleteExpired: async () => {
				const now = Date.now()
				data.tokens = Object.fromEntries(
					Object.entries(data.tokens).filter(([, token]) => token.expires > now),
				)
			},
		},
	},
})

pow.cleanup()
setInterval(() => pow.cleanup(), ms('1h'))
