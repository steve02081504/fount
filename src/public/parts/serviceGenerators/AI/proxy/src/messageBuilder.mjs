import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../../shells/chat/src/prompt_struct.mjs'

/**
 * 将 prompt_struct 转成 OpenAI 兼容消息数组。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 当前服务配置。
 * @param {object} configTemplate - 配置模板（默认值）。
 * @returns {Array<{role: 'user'|'assistant'|'system', content: string | object[]}>} OpenAI 格式消息数组。
 */
export function buildMessagesFromPromptStruct(prompt_struct, config, configTemplate) {
	const ignoreFiles = config.convert_config?.ignoreFiles ?? configTemplate.convert_config.ignoreFiles

	let messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
		const uid = Math.random().toString(36).slice(2, 10)
		let textContent = `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`

		/** @type {{role: 'user'|'assistant'|'system', content: string | object[]}} */
		const message = {
			role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
			content: textContent,
		}

		if (chatLogEntry.files?.length) {
			if (ignoreFiles) {
				const notices = chatLogEntry.files.map((file) => {
					const mime_type = file.mime_type || 'application/octet-stream'
					const name = file.name ?? 'unknown'
					return `[System Notice: can't show you about file '${name}' because you cant take the file input of type '${mime_type}', but you may be able to access it by using code tools if you have.]`
				})
				textContent += '\n' + notices.join('\n')
				message.content = textContent
				return message
			}
			const contentParts = [{ type: 'text', text: textContent }]

			for (const file of chatLogEntry.files) {
				if (!file.mime_type) continue

				if (file.mime_type.startsWith('image/'))
					contentParts.push({
						type: 'image_url',
						image_url: {
							url: `data:${file.mime_type};base64,${file.buffer.toString('base64')}`,
						},
					})
				else if (file.mime_type.startsWith('audio/')) {
					const formatMap = {
						'audio/wav': 'wav',
						'audio/wave': 'wav',
						'audio/x-wav': 'wav',
						'audio/mpeg': 'mp3',
						'audio/mp3': 'mp3',
						'audio/mp4': 'mp4',
						'audio/m4a': 'm4a',
						'audio/webm': 'webm',
						'audio/ogg': 'ogg',
					}
					const format = formatMap[file.mime_type.toLowerCase()] || 'wav'

					contentParts.push({
						type: 'input_audio',
						input_audio: {
							data: file.buffer.toString('base64'),
							format,
						},
					})
				}
			}

			if (contentParts.length > 1)
				message.content = contentParts
		}

		return message
	})

	const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
	if (config.system_prompt_at_depth ?? 10)
		messages.splice(Math.max(messages.length - (config.system_prompt_at_depth ?? 10), 0), 0, {
			role: 'system',
			content: system_prompt
		})
	else
		messages.unshift({
			role: 'system',
			content: system_prompt
		})

	if (config.convert_config?.roleReminding ?? true) {
		const isMultiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
		if (isMultiChar)
			messages.push({
				role: 'system',
				content: `现在请以${prompt_struct.Charname}的身份续写对话。`
			})
	}

	if (config.convert_config?.forceNoSystemMessages)
		messages = messages.map(m => {
			if (m.role !== 'system') return m
			return { role: 'user', content: 'system: ' + m.content }
		})

	if (config.convert_config?.forceUserMessageEnding)
		if (messages[messages.length - 1]?.role !== 'user')
			messages.push({
				role: 'user',
				content: '(继续)'
			})

	if (config.convert_config?.forceRoleAlternation) {
		const oldMessages = messages
		messages = []
		/** @type {'user'|'assistant'|'system'|null} */
		let lastRole = null

		for (const m of oldMessages) {
			if (m.role === lastRole) messages.push({
				role: lastRole === 'assistant' ? 'user' : 'assistant',
				content: `(${lastRole === 'assistant' ? '继续' : '收到'})`
			})

			messages.push(m)
			lastRole = m.role
		}
	}

	return messages
}
