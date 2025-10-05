import Cap from 'npm:@cap.js/server'

import { config } from '../server/server.mjs'

import { ms } from './ms.mjs'

// Initialize the pow section in the main config if it doesn't exist
const data = config.data.pow ??= {}
config.data.pow.challenges ??= {}
config.data.pow.tokens ??= {}

export const pow = new Cap({
	storage: {
		challenges: {
			store: async (token, challengeData) => {
				data.challenges[token] = challengeData
			},
			read: async (token) => {
				const pow = data.challenges[token]
				if (pow?.expires > Date.now()) return pow
				return null
			},
			delete: async (token) => {
				delete data.challenges[token]
			},
			deleteExpired: async () => {
				const now = Date.now()
				data.challenges = Object.fromEntries(
					Object.entries(data.challenges).filter(([, data]) => data.expires > now),
				)
			},
		},
		tokens: {
			store: async (tokenKey, expires) => {
				data.tokens[tokenKey] = { expires }
			},
			get: async (tokenKey) => {
				const token = data.tokens[tokenKey]
				if (token?.expires > Date.now()) return token.expires
				return null
			},
			delete: async (tokenKey) => {
				delete data.tokens[tokenKey]
			},
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
