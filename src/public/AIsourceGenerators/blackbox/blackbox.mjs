import axios from 'axios'

export class BlackboxAI {
	constructor(config) {
		this.apiUrl = 'https://api.blackbox.ai/api/chat'
		this.headers = {
			'Content-Type': 'application/json',
		}
		this.config = config
		this.conversationHistory = {}
		this.defaultModel = 'blackboxai'
	}

	async call(messages, model) {
		const payload = {
			messages,
			id: Date.now().toString(),
			previewToken: null,
			userId: null,
			codeModelMode: true,
			agentMode: {},
			trendingAgentMode: {},
			isMicMode: false,
			userSystemPrompt: null,
			maxTokens: 1024,
			playgroundTopP: 0.9,
			playgroundTemperature: 0.5,
			isChromeExt: false,
			githubToken: null,
			clickedAnswer2: false,
			clickedAnswer3: false,
			clickedForceWebSearch: false,
			visitFromDelta: false,
			mobileClient: false,
			userSelectedModel: model || this.defaultModel
		}

		try {
			const response = await axios.post(this.apiUrl, payload, { headers: this.headers })
			return response.data.replace(/\n*generated by blackbox\.ai, try unlimited chat https:\/\/www\.blackbox\.ai\/?\n*/gi, '')
		} catch (error) {
			console.error('Error communicating with Blackbox.ai:', error)
			throw error
		}
	}

	async countTokens(text) {
		const payload = {
			text
		}

		try {
			const response = await axios.post('https://api.blackbox.ai/api/token-count', payload, { headers: this.headers })
			return response.data.tokenCount
		} catch (error) {
			console.error('Error communicating with Blackbox.ai:', error)
			throw error
		}
	}
}
