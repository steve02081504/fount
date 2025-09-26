export class DuckDuckGoAPI {
	constructor(config) {
		this.config = config
		this.fake_headers = config.fake_headers || {
			Accept: '*/*',
			'Accept-Encoding': 'gzip, deflate, br, zstd',
			'Accept-Language': 'zh-CN,zh;q=0.9',
			Origin: 'https://duckduckgo.com/',
			Cookie: 'dcm=3',
			Dnt: '1',
			Priority: 'u=1, i',
			Referer: 'https://duckduckgo.com/',
			'Sec-Ch-Ua': '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99"',
			'Sec-Ch-Ua-Mobile': '?0',
			'Sec-Ch-Ua-Platform': '"Windows"',
			'Sec-Fetch-Dest': 'empty',
			'Sec-Fetch-Mode': 'cors',
			'Sec-Fetch-Site': 'same-origin',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
		}
	}

	async requestToken() {
		try {
			const response = await fetch('https://duckduckgo.com/duckchat/v1/status', {
				method: 'GET',
				headers: {
					...this.fake_headers,
					'x-vqd-accept': '1',
				},
			})
			return response.headers.get('x-vqd-4')
		}
		catch (error) {
			console.error('Request token error: ', error)
			throw error
		}
	}

	async createCompletion(model, content, returnStream) {
		const token = await this.requestToken()
		const response = await fetch('https://duckduckgo.com/duckchat/v1/chat', {
			method: 'POST',
			headers: {
				...this.fake_headers,
				Accept: 'text/event-stream',
				'Content-Type': 'application/json',
				'x-vqd-4': token,
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: 'user',
						content,
					},
				],
			}),
		})

		if (!response.ok)
			throw new Error(`Create Completion error! status: ${response.status}`)

		return this.handlerStream(model, response.body, returnStream)
	}

	async handlerStream(model, rb, returnStream) {
		let bwzChunk = ''
		let previousText = ''
		const handChunkData = chunk => {
			chunk = chunk.trim()
			if (bwzChunk !== '') {
				chunk = bwzChunk + chunk
				bwzChunk = ''
			}

			if (chunk.includes('[DONE]'))
				return chunk


			if (chunk.slice(-2) !== '"}')
				bwzChunk = chunk

			return chunk
		}
		const reader = rb.getReader()
		const decoder = new TextDecoder()
		const encoder = new TextEncoder()
		const stream = new ReadableStream({
			async start(controller) {
				while (true) {
					const { done, value } = await reader.read()
					if (done)
						return controller.close()

					const chunkStr = handChunkData(decoder.decode(value))
					if (bwzChunk !== '')
						continue


					chunkStr.split('\n').forEach(line => {
						if (line.length < 6)
							return

						line = line.slice(6)
						if (line !== '[DONE]') {
							const originReq = JSON.parse(line)

							if (originReq.action !== 'success')
								return controller.error(new Error('Error: originReq stream chunk is not success'))


							if (originReq.message) {
								previousText += originReq.message
								if (returnStream)
									controller.enqueue(
										encoder.encode(`data: ${JSON.stringify(this.newChatCompletionChunkWithModel(originReq.message, model))}\n\n`)
									)
							}
						}
						else {
							if (returnStream)
								controller.enqueue(encoder.encode(`data: ${JSON.stringify(this.newStopChunkWithModel('stop', model))}\n\n`))
							else
								controller.enqueue(encoder.encode(JSON.stringify(this.newChatCompletionWithModel(previousText, model))))

							return controller.close()
						}
					})
					continue
				}
			},
		})

		return new Response(stream, {
			headers: {
				'Content-Type': returnStream ? 'text/event-stream' : 'application/json',
			},
		})
	}

	messagesPrepare(messages) {
		let content = ''
		for (const message of messages) {
			const role = message.role === 'system' ? 'user' : message.role

			if (['user', 'assistant'].includes(role)) {
				const contentStr = Array.isArray(message.content)
					? message.content
						.filter(item => item.text)
						.map(item => item.text)
						.join('') || ''
					: message.content
				content += `${role}:${contentStr};\r\n`
			}
		}
		return content
	}

	async call(messages, model = 'gpt-4o-mini', returnStream = false) {
		const content = this.messagesPrepare(messages)
		const response = await this.createCompletion(model, content, returnStream)
		if (returnStream)
			return response // 返回 ReadableStream
		else
			return await response.text() // 返回完整文本
	}

	countTokens(text) {
		// 简单实现，可以根据需要改进
		return text.length
	}

	newChatCompletionChunkWithModel(text, model) {
		return {
			id: 'chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK',
			object: 'chat.completion.chunk',
			created: 0,
			model,
			choices: [
				{
					index: 0,
					delta: {
						content: text,
					},
					finish_reason: null,
				},
			],
		}
	}

	newStopChunkWithModel(reason, model) {
		return {
			id: 'chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK',
			object: 'chat.completion.chunk',
			created: 0,
			model,
			choices: [
				{
					index: 0,
					finish_reason: reason,
				},
			],
		}
	}

	newChatCompletionWithModel(text, model) {
		return {
			id: 'chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK',
			object: 'chat.completion',
			created: 0,
			model,
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
			choices: [
				{
					message: {
						content: text,
						role: 'assistant',
					},
					index: 0,
				},
			],
		}
	}
}
