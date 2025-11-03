// claude_api.mjs
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

const AI = {
	/**
	 * 获取 API 端点。
	 * @returns {string} API 端点。
	 */
	end: () => Buffer.from([104, 116, 116, 112, 115, 58, 47, 47, 97, 112, 105, 46, 99, 108, 97, 117, 100, 101, 46, 97, 105]).toString(),
	/**
	 * 获取用户代理。
	 * @returns {string} 用户代理。
	 */
	agent: () => Buffer.from([77, 111, 122, 105, 108, 108, 97, 47, 53, 46, 48, 32, 40, 87, 105, 110, 100, 111, 119, 115, 32, 78, 84, 32, 49, 48, 46, 48, 59, 32, 87, 105, 110, 54, 52, 59, 32, 120, 54, 52, 41, 32, 65, 112, 112, 108, 101, 87, 101, 98, 75, 105, 116, 47, 53, 51, 55, 46, 51, 54, 32, 40, 75, 72, 84, 77, 76, 44, 32, 108, 105, 107, 101, 32, 71, 101, 99, 107, 111, 41, 32, 67, 104, 114, 111, 109, 101, 47, 49, 49, 54, 46, 48, 46, 48, 46, 48, 32, 83, 97, 102, 97, 114, 105, 47, 53, 51, 55, 46, 51, 54]).toString(),
	/**
	 * 获取额外的请求头。
	 * @returns {object} 额外的请求头。
	 */
	extra: () => JSON.parse(Buffer.from([123, 34, 115, 101, 99, 45, 99, 104, 45, 117, 97, 34, 58, 34, 92, 34, 67, 104, 114, 111, 109, 105, 117, 109, 92, 34, 59, 118, 61, 92, 34, 49, 49, 54, 92, 34, 44, 32, 92, 34, 78, 111, 116, 59, 65, 61, 66, 114, 97, 110, 100, 92, 34, 59, 118, 61, 92, 34, 50, 52, 92, 34, 44, 32, 92, 34, 77, 105, 99, 114, 111, 115, 111, 112, 104, 116, 32, 69, 100, 103, 101, 92, 34, 59, 118, 61, 92, 34, 49, 49, 54, 92, 34, 34, 44, 34, 115, 101, 99, 45, 99, 104, 45, 117, 97, 45, 109, 111, 98, 105, 108, 101, 34, 58, 34, 63, 48, 34, 44, 34, 115, 101, 99, 45, 99, 104, 45, 117, 97, 45, 112, 108, 97, 116, 102, 111, 114, 109, 34, 58, 34, 92, 34, 87, 105, 110, 100, 111, 119, 115, 92, 34, 34, 44, 34, 115, 101, 99, 45, 102, 101, 116, 99, 104, 45, 100, 101, 115, 116, 34, 58, 34, 101, 109, 112, 116, 121, 34, 44, 34, 115, 101, 99, 45, 102, 101, 116, 99, 104, 45, 109, 111, 100, 101, 34, 58, 34, 110, 97, 118, 105, 103, 97, 116, 101, 34, 44, 34, 115, 101, 99, 45, 102, 101, 116, 99, 104, 45, 115, 105, 116, 101, 34, 58, 34, 110, 111, 110, 101, 34, 44, 34, 115, 101, 99, 45, 102, 101, 116, 99, 104, 45, 117, 115, 101, 114, 34, 58, 34, 63, 49, 34, 44, 34, 117, 112, 103, 114, 97, 100, 101, 45, 105, 110, 115, 101, 99, 117, 114, 101, 45, 114, 101, 113, 117, 101, 115, 116, 115, 34, 58, 49, 125]).toString()),
	/**
	 * 获取请求头。
	 * @param {string} refPath - 引用路径。
	 * @returns {object} 请求头。
	 */
	hdr: refPath => ({
		...AI.extra(),
		'Content-Type': 'application/json',
		'User-Agent': AI.agent(),
		Referer: `${AI.end()}/${refPath ? 'chat/' + refPath : ''}`,
		Origin: '' + AI.end()
	}),
	/**
	 * 获取时区。
	 * @returns {string} 时区。
	 */
	zone: () => Buffer.from([65, 109, 101, 114, 105, 99, 97, 47, 78, 101, 119, 95, 89, 111, 114, 107]).toString(),
}

/**
 * 检查响应中是否有错误。
 * @param {Response} res - 响应对象。
 * @param {boolean} throwIt - 如果发现错误，是否抛出。
 * @returns {Promise<Error|undefined>} 错误（如果发现）。
 */
async function checkResErr(res, throwIt = true) {
	let err, json, errAPI
	if (res.status < 200 || res.status >= 300) {
		err = new Error('Unexpected response code: ' + res.status)

		try {
			const text = await res.text()
			json = JSON.parse(text)
			errAPI = json.error
		}
		catch {
			err.message += ' ' + await res.text() // 原始响应文本
			if (throwIt) throw err
			return err
		}

		if (errAPI) {
			err.status = res.status
			err.planned = true
			errAPI.message && (err.message = errAPI.message)
			errAPI.type && (err.type = errAPI.type)

			// 429 错误特殊处理
			if (429 === res.status) try {
				const errorData = JSON.parse(errAPI.message)
				if (errorData.resetsAt) {
					const hours = ((new Date(1e3 * errorData.resetsAt).getTime() - Date.now()) / 1e3 / 60 / 60).toFixed(1)
					err.message += `, expires in ${hours} hours`
				}
				err.exceeded_limit = true // 添加标记
			} catch { }
		}

		if (throwIt) throw err
	}
	return err
}

/**
 * ClewdStream 类的模拟，用于非流式响应。
 */
class ClewdSimulation {
	/**
	 * 创建 ClewdSimulation 的实例。
	 * @param {object} config - 配置对象。
	 * @param {string} model - 要使用的模型。
	 */
	constructor(config, model) {
		this.config = config
		this.model = model
		this.impersonated = false // 简单模拟
	}

	/**
	 * 检查回复中是否有个性化。
	 * @param {string} reply - 要检查的回复。
	 * @returns {boolean} 是否检测到个性化。
	 */
	impersonationCheck(reply) {
		// 简单实现：检查是否包含 "Human:" 或 "Assistant:"
		if (reply.includes('Human:') || reply.includes('Assistant:')) {
			this.impersonated = true // 设置标志
			if (this.config.prevent_imperson)  // 假设有一个 PreventImperson 配置
				return true  // 阻止进一步处理
		}
		return false
	}

	/**
	 * 处理响应。
	 * @param {object} response - 要处理的响应。
	 * @returns {object} 处理后的响应。
	 */
	processResponse(response) {
		if (response.completion)
			// 非流式响应，直接检查 impersonation
			if (this.impersonationCheck(response.completion))
				// 如果检测到 impersonation 且 PreventImperson 为 true, 截断
				response.completion = response.completion.split(/Human:|Assistant:/)[0].trim()



		return response
	}
}


/**
 * 用于与 Claude API 交互的 ClaudeAPI 类。
 */
export class ClaudeAPI {
	/**
	 * 创建 ClaudeAPI 的实例。
	 * @param {object} config - 配置对象。
	 * @param {Function} SaveConfig - 保存配置的函数。
	 */
	constructor(config, SaveConfig) {
		this.config = config
		this.SaveConfig = SaveConfig
		this.currentIndex = 0  // 移除 config.cookieIndex
		this.failedCookies = new Set()   // 失败的 Cookie 集合
		this.changing = false          // 是否正在切换 Cookie
		this.uuidOrg = ''              // 组织 UUID
		this.conversationUuid = ''     // 对话 UUID
		this.prevPrompt = {}           // 上一次的 Prompt (用于判断是否需要重置对话)
		this.prevMessages = []         // 上一次的 Messages
		this.prevImpersonated = false    // 上一次是否发生了角色扮演
	}

	/**
	 * 获取 Cookie。
	 * @returns {string} Cookie。
	 */
	getCookies() {
		if (!this.config.cookie_array?.length) return ''

		const cookie = this.config.cookie_array[this.currentIndex] || ''
		const match = cookie.match(/(?:(claude[_-][\d_a-z-]*?)@)?(?:sessionKey=)?(sk-ant-sid01-[\w-]+(?:-[\w-]{6}AA)?)/)
		return match ? match[2] : ''
	}

	/**
	 * 首次登录并获取组织 UUID。
	 * @returns {Promise<void>}
	 */
	async firstLogin() {
		if (!this.config.cookie_array?.length || this.uuidOrg)
			return

		if (!this.getCookies()) return console.warn('No valid cookie found.')

		let attempts = 0
		const maxAttempts = this.config.cookie_counter > 0 ? this.config.cookie_counter : 3 // 默认重试 3 次

		while (attempts < maxAttempts) try {
			const headers = AI.hdr()
			headers.Cookie = `sessionKey=${this.getCookies()}`
			const rProxy = this.config.r_proxy || AI.end()

			const orgsResponse = await fetch(`${rProxy}/api/organizations`, {
				method: 'GET',
				headers,
			})

			const orgsErr = await checkResErr(orgsResponse, false)
			if (orgsErr)
				throw orgsErr // 抛出自定义错误


			const orgs = await orgsResponse.json()
			const org = orgs?.[0]
			if (!org || org.error)
				throw new Error(`Couldn't get account info: ${org?.error?.message || orgsResponse.statusText}`)

			if (!org?.uuid) throw new Error('Invalid account id')

			this.uuidOrg = org.uuid
			console.log(`Logged in to Claude API. Organization UUID: ${this.uuidOrg}`)
			return // 成功获取到 uuidOrg，直接返回
		} catch (error) {
			console.error(`First login attempt ${attempts + 1} failed:`, error)
			attempts++

			if (this.shouldRotateCookie(error)) {
				this.failedCookies.add(this.config.cookie_array[this.currentIndex])
				await this.cookieChanger() // 轮换 Cookie，但不清理
			}
			else if (this.shouldCleanCookie(error))
				if (this.config.cookie_array.length > 1) this.cookieCleaner(error.message) // 清理 Cookie
				else console.warn('Only one cookie available, or cookies are exhausted.')

			if (attempts < maxAttempts) {
				console.log('Retrying in 5 seconds...')
				await new Promise(resolve => setTimeout(resolve, 5000)) // 等待 5 秒
			}
		}

		// 所有尝试都失败了
		console.error('First login failed after multiple attempts.')
		if (this.config.cookie_array.length)
			this.cookieCleaner('Failed firstLogin after retry') // 清理当前 Cookie
	}

	/**
	 * 决定是否轮换 Cookie。
	 * @param {Error} error - 错误对象。
	 * @returns {boolean} 是否轮换 Cookie。
	 */
	shouldRotateCookie(error) {
		return (
			error.status &&  // 使用 error.status
			(error.status === 429 ||  // Rate Limit
				error.status === 401)  // Unauthorized
		) || (error.message && error.message.includes('Overloaded'))
	}

	/**
	 * 决定是否清理 Cookie。
	 * @param {Error} error - 错误对象。
	 * @returns {boolean} 是否清理 Cookie。
	 */
	shouldCleanCookie(error) {
		return error.status && (  // 使用 error.status
			error.status === 400 || // Bad Request
			error.status === 403     // Forbidden
		)
	}

	/**
	 * 更换 Cookie。
	 * @returns {Promise<void>}
	 */
	async cookieChanger() {
		if (!this.config.cookie_array || this.config.cookie_array.length <= 1) {
			if (!this.config.cookie_array.length) return
			else
				console.warn('Only one cookie available, or cookies are exhausted.')
			return
		}

		this.changing = true
		try {
			let nextIndex = (this.currentIndex + 1) % this.config.cookie_array.length
			while (this.failedCookies.has(this.config.cookie_array[nextIndex]) && nextIndex !== this.currentIndex)
				nextIndex = (nextIndex + 1) % this.config.cookie_array.length


			if (nextIndex === this.currentIndex)
				// 循环回当前索引，所有 Cookie 都失败了
				if (this.failedCookies.size === this.config.cookie_array.length) {
					console.warn('All cookies failed')
					return //在主循环中会再次尝试
				}


			this.currentIndex = nextIndex
			// this.config.cookie_index = this.currentIndex; //移除
			console.log(`Rotated to cookie index ${this.currentIndex + 1}.`)
			this.SaveConfig()
		}
		finally {
			this.changing = false // 确保标记被重置
		}
	}

	/**
	 * 清理 Cookie。
	 * @param {string} flag - 清理 Cookie 的原因。
	 * @returns {void}
	 */
	cookieCleaner(flag) {
		if (!this.config.cookie_array?.length) return

		const currentCookie = this.config.cookie_array[this.currentIndex]
		console.log(`Cleaning cookie: ${currentCookie} due to: ${flag}`)

		this.config.cookie_array = this.config.cookie_array.filter((_, index) => index !== this.currentIndex)
		this.failedCookies.delete(currentCookie) // 从失败集合中移除

		// 调整索引 移除
		// this.config.cookie_index = Math.min(this.config.cookie_array.length - 1, this.currentIndex);
		// if (this.config.cookie_index < 0) this.config.cookie_index = 0;
		this.currentIndex = 0 //重置
		// this.config.cookie_counter < 0 || (this.config.cookie_array.length <= 1 && (this.config.cookie_counter = 1)); //移除
		this.SaveConfig()  // 保存更改

		if (this.config.cookie_array.length) // 如果还有剩余的cookie
			this.cookieChanger() // 切换
	}

	/**
	 * 等待 Cookie 更换完成。
	 * @returns {Promise<void>}
	 */
	async waitForChange() {
		return new Promise(resolve => {
			const interval = setInterval(() => {
				if (!this.changing) {
					clearInterval(interval)
					resolve()
				}
			}, 100)
		})
	}

	/**
	 * 决定是否续订聊天。
	 * @param {Array<object>} messages - 消息对象数组。
	 * @returns {boolean} 是否续订聊天。
	 */
	shouldRenewChat(messages) {
		const currentPrompt = {
			firstUser: messages.find(m => m.role === 'user'),
			firstSystem: messages.find(m => m.role === 'system'),
			lastUser: messages.findLast(m => m.role === 'user'),
			lastSystem: messages.findLast(m => m.role === 'system' && m.content !== '[Start a new chat]'),
		}

		const samePrompt = JSON.stringify(messages.filter(m => m.role !== 'system')) === JSON.stringify(this.prevMessages.filter(m => m.role !== 'system'))
		const sameCharDiffChat = !samePrompt && currentPrompt.firstSystem?.content === this.prevPrompt.firstSystem?.content && currentPrompt.firstUser?.content !== this.prevPrompt.firstUser?.content

		// 综合考虑各种因素来决定是否创建新对话
		return (
			this.config.renew_always ||              // 如果配置了 RenewAlways，则总是创建新对话
			!this.conversationUuid ||              // 如果没有对话 UUID，则创建新对话
			this.prevImpersonated ||               // 如果上次发生了角色扮演，则创建新对话
			(!this.config.renew_always && samePrompt) || // 如果 Prompt 相同且未配置 RenewAlways，则不创建
			sameCharDiffChat                      // 如果是相同角色的不同对话，则创建
		)
	}

	/**
	 * 调用 Claude API。
	 * @param {Array<object>} messages - 消息对象数组。
	 * @param {string} model - 要使用的模型。
	 * @returns {Promise<string>} API 的响应。
	 */
	async callClaudeAPI(messages, model) {
		if (!this.config.cookie_array?.length)
			throw new Error('No cookies configured. Please add at least one Claude API cookie to the configuration.')

		// 检查 uuidOrg
		if (!this.uuidOrg) {
			await this.firstLogin()
			if (!this.uuidOrg)
				throw new Error('Claude API initialization failed: Could not retrieve organization UUID.')
		}

		await this.waitForChange()

		// 根据 clewd 的逻辑，判断是否创建新对话
		const shouldRenew = this.shouldRenewChat(messages)
		if (shouldRenew) {
			this.conversationUuid = randomUUID() // 创建新的对话 UUID
			console.log('Starting new conversation, UUID:', this.conversationUuid)
		}
		else console.log('Continuing conversation, UUID:', this.conversationUuid)

		// 更新 prevPrompt 和 prevMessages (在 shouldRenewChat 之后)
		this.prevPrompt = {
			firstUser: messages.find(m => m.role === 'user'),
			firstSystem: messages.find(m => m.role === 'system'),
			lastUser: messages.findLast(m => m.role === 'user'),
			lastSystem: messages.findLast(m => m.role === 'system' && m.content !== '[Start a new chat]'),
		}
		this.prevMessages = JSON.parse(JSON.stringify(messages)) // 深拷贝


		let attempt = 0
		while (attempt < this.config.cookie_array.length + 1) try {
			const headers = AI.hdr(this.conversationUuid) // 传入 conversationUuid
			headers.Cookie = `sessionKey=${this.getCookies()}`
			const rProxy = this.config.r_proxy || AI.end()

			// 构建 prompt 字符串
			const prompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n') + '\n\nAssistant:'

			const payload = {
				completion: {
					prompt,
					timezone: AI.zone(),
					model: model || this.config.model, // 如果提供了模型，则使用，否则使用配置中的模型
				},
				organization_uuid: this.uuidOrg,
				conversation_uuid: this.conversationUuid,
				text: prompt,  // 这里的 text 似乎和 prompt 重复，根据实际 API 调整
				attachments: [], // 根据需要添加
			}


			const response = await fetch(`${rProxy}/api/organizations/${this.uuidOrg}/chat_conversations/${this.conversationUuid}/completion`, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			})

			const err = await checkResErr(response, false)
			if (err)
				throw err

			let responseJSON = await response.json()

			const claudeSim = new ClewdSimulation(this.config, model) // 传入配置
			responseJSON = claudeSim.processResponse(responseJSON) // 处理响应
			this.prevImpersonated = claudeSim.impersonated // 更新状态

			if (responseJSON.completion)
				return responseJSON.completion
			else
				throw new Error('Claude API error: empty response')
		} catch (error) {
			console.error('Claude API call failed:', error)

			if (this.shouldRotateCookie(error)) {
				this.failedCookies.add(this.config.cookie_array[this.currentIndex])
				this.cookieChanger()
				attempt = 0 // 重置尝试次数
				await this.waitForChange()
			}
			else if (this.shouldCleanCookie(error)) {
				if (this.config.cookie_array.length > 1) this.cookieCleaner(error.message) // 清理 Cookie
				else console.warn('Only one cookie available, or cookies are exhausted.')
				attempt = 0
				await this.waitForChange()
			}
			else attempt++
		}

		throw new Error('All configured cookies have failed.')
	}
};
