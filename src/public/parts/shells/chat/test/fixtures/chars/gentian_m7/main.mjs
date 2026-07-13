import { GetReply } from './reply_gener/index.mjs'
import { initTriggerIdentity, onMessage } from './trigger/onMessage.mjs'

/** @type {{ error?: Error, context?: object } | null} */
export let lastOnError = null

/** @type {import('fount/decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: '龙胆 M7',
			avatar: '🌸',
			description: 'M7 壳层契约验收 fixture（非龙胆逻辑副本）',
			version: '1.0.0',
			author: 'fount',
			tags: ['test', 'm7'],
		},
	},
	/**
	 * @param {object} stat Load 参数
	 */
	Load: async stat => {
		lastOnError = null
		await initTriggerIdentity(stat.username)
	},
	/**
	 * @param {Error} error 错误
	 * @param {object} context 上下文
	 * @returns {Promise<boolean>} true 表示已处理
	 */
	OnError: async (error, context) => {
		lastOnError = { error, context }
		return true
	},
	interfaces: {
		chat: {
			GetReply,
			onMessage,
		},
	},
}
