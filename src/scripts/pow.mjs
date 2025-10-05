import Cap from 'npm:@cap.js/server'

import { config, save_config } from '../server/server.mjs'

// Initialize the pow section in the main config if it doesn't exist
const data = config.data.pow ??= {}
config.data.pow.challenges ??= {}
config.data.pow.tokens ??= {}

export const pow = new Cap({
	storage: {
		challenges: {
			store: async (token, challengeData) => {
				data.challenges[token] = challengeData
				save_config() // Persist changes
			},
			read: async (token) => {
				const pow = data.challenges[token]
				if (pow?.expires > Date.now()) return pow
				return null
			},
			delete: async (token) => {
				delete data.challenges[token]
				save_config()
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
				save_config()
			},
			get: async (tokenKey) => {
				const token = data.tokens[tokenKey]
				if (token?.expires > Date.now()) return token.expires
				return null
			},
			delete: async (tokenKey) => {
				delete data.tokens[tokenKey]
				save_config()
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
