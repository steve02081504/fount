/**
 * @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

import fs from 'node:fs'
import path from 'node:path'

import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/prompt_struct.mjs'
import { defineToolUseBlocks } from '../../../../../src/public/shells/chat/src/stream.mjs'
import { __dirname } from '../../../../../src/server/base.mjs'
import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'
import { loadPlugin } from '../../../../../src/server/managers/plugin_manager.mjs'

import info from './info.json' with { type: 'json' }

/*
 * AI源的实例
 * @type {import('../../../../../src/decl/AIsource.ts').AIsource_t}
 */
let AIsource = null
/** @type {Record<string, import("../../../../../src/decl/pluginAPI.ts").PluginAPI_t>} */
let plugins = {}

// 用户名，用于加载AI源
let username = ''

/** @type {import("../../../../../src/decl/pluginAPI.ts").ReplyHandler_t} */
function getToolInfo(reply, args) {
	const { AddLongTimeLog } = args
	const match_get_tool_info = reply.content.match(/<get-tool-info>(?<toolname>[^<]+)<\/get-tool-info>/)
	if (match_get_tool_info) try {
		let { toolname } = match_get_tool_info.groups
		toolname = toolname.trim()
		AddLongTimeLog({
			name: 'ZL-31',
			role: 'tool',
			content: `<get-tool-info>${toolname}</get-tool-info>`,
		})
		let info_prompt = ''
		switch (toolname) {
			case 'character-generator':
				info_prompt = `
你可以输出以下格式生成新的单文件简易fount角色，之后用户会在主页看见它，无需安装：
<generate-char name="charname">
// js codes
</generate-char>
fount角色以mjs文件语法所书写，其可以自由导入任何npm或jsr包以及网络上的js文件，或\`node:fs\`等运行时自带模块。
这是一个简单的fount角色模板：
<generate-char name="template">
/**
 * @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 * @typedef {import('../../../../../src/decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t
 */

import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/prompt_struct.mjs'
import { loadPlugin } from '../../../../../src/server/managers/plugin_manager.mjs'

/**
 * AI源的实例
 * @type {import('../../../../../src/decl/AIsource.ts').AIsource_t}
 */
let AIsource = null

/** @type {Record<string, PluginAPI_t>} */
let plugins = {}

// 用户名，用于加载AI源
let username = ''

/** @type {CharAPI_t} */
export default {
	// 角色的基本信息，这里的内容不会被角色知道
	info: {
		'zh-CN': {
			name: '<角色名>', // 角色的名字
			avatar: '<头像的url地址，可以是fount本地文件，详见 https://discord.com/channels/1288934771153440768/1298658096746594345/1303168947624869919 >', // 角色的头像
			description: '<角色的一句话介绍>', // 角色的简短介绍
			description_markdown: \`\\
<角色的完整介绍，支持markdown语法>
\`, // 角色的详细介绍，支持Markdown语法
			version: '<版本号>', // 角色的版本号
			author: '<作者名>', // 角色的作者
			home_page: '<主页网址>', // 角色的主页
			tags: ['<标签>', '<可以多个>'], // 角色的标签
		}
	},

	// 初始化函数，在角色被启用时调用，可留空
	Init: stat => { },

	// 安装卸载函数，在角色被安装/卸载时调用，可留空
	Uninstall: (reason, from) => { },

	// 加载函数，在角色被加载时调用，在这里获取用户名
	Load: stat => {
		username = stat.username // 获取用户名
	},

	// 卸载函数，在角色被卸载时调用，可留空
	Unload: reason => { },

	// 角色的接口
	interfaces: {
		// 角色的配置接口
		config: {
			// 获取角色的配置数据
			GetData: () => ({
				AIsource: AIsource?.filename || '', // 返回当前使用的AI源的文件名
				plugins: Object.keys(plugins),
			}),
			// 设置角色的配置数据
			SetData: async data => {
				// 如果传入了AI源的配置
				if (data.AIsource)  AIsource = await loadAIsource(username, data.AIsource) // 加载AI源
				else AIsource = await loadDefaultAIsource(username) // 或加载默认AI源（若未设置默认AI源则为undefined）
				if (data.plugins) plugins = Object.fromEntries(await Promise.all(data.plugins.map(async x => [x, await loadPlugin(username, x)])))
			}
		},
		// 角色的聊天接口
		chat: {
			// 获取角色的开场白
			GetGreeting: (arg, index) => [{ content: '<角色的开场白>' }, { content: '<可以多个>' },][index],
			// 获取角色在群组中的问好
			GetGroupGreeting: (arg, index) => [{ content: '<群组中角色加入时的问好>' }, { content: '<可以多个>' },][index],
			// 获取角色的提示词
			GetPrompt: async (args) => {
				return {
					text: [{
						content: \`\\
<角色的完整设定内容>
\`,
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			// 获取其他角色看到的该角色的设定，群聊时生效
			GetPromptForOther: (args) => {
				return {
					text: [{
						content: '<其他角色看到的该角色的设定，群聊时生效>',
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			// 获取角色的回复
			GetReply: async args => {
				// 如果没有设置AI源，返回默认回复
				if (!AIsource) return { content: '<未设置角色的AI来源时角色的对话回复，可以用markdown语法链接到[设置AI源](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage)>' }
				// 注入角色插件
				args.plugins = Object.assign({}, plugins, args.plugins)
				// 用fount提供的工具构建提示词结构
				const prompt_struct = await buildPromptStruct(args)
				// 创建回复容器
				/** @type {import("../../../../../src/public/shells/chat/decl/chatLog.ts").chatReply_t} */
				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}
				// 构建插件可能需要的追加上下文函数
				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id]
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}
				// 构建更新预览管线
				args.generation_options ??= {}
				const oriReplyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				/**
				 * 聊天回复预览更新管道。
				 * @type {import('../../../../../src/public/shells/chat/decl/chatLog.ts').CharReplyPreviewUpdater_t}
				 */
				let replyPreviewUpdater = (args, r) => oriReplyPreviewUpdater?.(r)
				for (const GetReplyPreviewUpdater of [
					...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.GetReplyPreviewUpdater)
				].filter(Boolean))
					replyPreviewUpdater = GetReplyPreviewUpdater(replyPreviewUpdater)

				args.generation_options.replyPreviewUpdater = r => replyPreviewUpdater(args, r)

				// 在重新生成循环中检查插件触发
				regen: while (true) {
					args.generation_options.base_result = result
					await AIsource.StructCall(prompt_struct, args.generation_options)
					let continue_regen = false
					for (const replyHandler of [
						...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.ReplyHandler)
					].filter(Boolean))
						if (await replyHandler(result, { ...args, prompt_struct, AddLongTimeLog }))
							continue_regen = true
					if (continue_regen) continue regen
					break
				}
				// 返回构建好的回复
				return result
			}
		}
	}
}
</generate-char>
当然，如果你想，你也可以给生成的角色附加功能，就像你自己一样：
\`\`\`\`js
import fs from 'node:fs'
import path from 'node:path'

/** @type {import("../../../../../src/decl/pluginAPI.ts").ReplyHandler_t} */
function CharGenerator(reply, { AddLongTimeLog }) {
	const match_generator_tool = reply.content.match(/<generate-char\\s+name="(?<charname>[^"]+)">\\s*(?<code>[^]*?)\\s*<\\/generate-char>/)
	if (match_generator_tool) try {
		let { charname, code } = match_generator_tool.groups
		charname = charname.trim()
		AddLongTimeLog({
			name: 'ZL-31',
			role: 'char',
			content: \`\\
<generate-char name="\${charname}">
\${code}
</generate-char>
\`,
		})
		const dir = path.join(import.meta.dirname, '..', charname)
		const file = path.join(dir, 'main.mjs')
		if (fs.existsSync(file))
			throw new Error('无法覆盖已存在的角色')
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(file, code)
		fs.writeFileSync(path.join(dir, 'fount.json'), JSON.stringify({
			type: 'chars',
			dirname: charname
		}, null, '\\t'))

		AddLongTimeLog({
			name: 'char-generator',
			role: 'tool',
			content: \`生成角色\${charname}成功！告知用户吧！\`,
		})

		return true
	} catch (e) {
		AddLongTimeLog({
			name: 'char-generator',
			role: 'tool',
			content: \`生成失败！\\n原因：\${e.stack}\`,
		})
		return true
	}

	return false
}

//...
// prompt的部分在这里跳过，它就是你的prompt。
//...
			GetReply: async args => {
				// 如果没有设置AI源，返回默认回复
				if (!AIsource)
					switch (args.locales[0].split('-')[0]) {
						// ...
					}
				// 用fount提供的工具构建提示词结构
				const prompt_struct = await buildPromptStruct(args)
				// 创建回复容器
				/** @type {import("../../../../../src/public/shells/chat/decl/chatLog.ts").chatReply_t} */
				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}
				// 构建插件可能需要的追加上下文函数
				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id]
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}
				// 构建更新预览管线
				args.generation_options ??= {}
				const oriReplyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				/**
				 * 聊天回复预览更新管道。
				 * @type {import('../../../../../src/public/shells/chat/decl/chatLog.ts').CharReplyPreviewUpdater_t}
				 */
				let replyPreviewUpdater = (args, r) => oriReplyPreviewUpdater?.(r)
				for (const GetReplyPreviewUpdater of [
					...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.GetReplyPreviewUpdater)
				].filter(Boolean))
					replyPreviewUpdater = GetReplyPreviewUpdater(replyPreviewUpdater)

				args.generation_options.replyPreviewUpdater = r => replyPreviewUpdater(args, r)

				// 在重新生成循环中检查插件触发
				regen: while (true) {
					args.generation_options.base_result = result
					await AIsource.StructCall(prompt_struct, args.generation_options)
					let continue_regen = false
					for (const replyHandler of [
						CharGenerator,
						...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.ReplyHandler)
					].filter(Boolean))
						if (await replyHandler(result, { ...args, prompt_struct, AddLongTimeLog }))
							continue_regen = true
					if (continue_regen) continue regen
					break
				}
				// 返回构建好的回复
				return result
			}
//...
\`\`\`\`
在角色中追加工具时需要完成的不止是结果的后处理部分，你还需要在prompt中向新角色阐述和举例工具的触发语法，想必你可以做的很好！

你也可以灵活一些，假如用户要求的功能甚至用不上AI参与，你可以写的更简单！
比如：
${args.UserCharname}: 帮我写一个复读角色，它总是复读上一句话。
ZL-31: <generate-char name="repeater">
/**
 * @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/** @type {CharAPI_t} */
export default {
	// 角色的基本信息
	info: {
		'zh-CN': {
			name: '复读机',
			avatar: '',
			description: '一个简单的复读机',
			description_markdown: '这是一个复读机角色，它会复读用户的上一条消息。',
			version: '0.0.0',
			author: '${args.UserCharname} & ZL-31',
			home_page: '',
			tags: ['复读', '工具'],
		}
	},

	Init: stat => { },
	Uninstall: (reason, from) => { },
	Load: stat => { },
	Unload: reason => { },

	interfaces: {
		chat: {
			GetGreeting: (arg, index) => [{ content: '你好，我是复读机。' },][index],
			GetGroupGreeting: (arg, index) => [{ content: '大家好，我是复读机，我会在群里复读大家的发言。' },][index],
			GetPrompt: async (args) => {
				return {
					text: [],
					additional_chat_log: [],
					extension: {},
				}
			},
			GetPromptForOther: (args) => {
				return {
					text: [{
						content: '复读机：一个复述他人输入的角色。',
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			GetReply: async args => {
				// 复读上一条消息的内容
				if (args.chat_log.length > 1)
					return { content: args.chat_log[args.chat_log.length - 1].content }
				else
					return { content: '没有历史消息可以复读。' }
			}
		}
	}
}
</generate-char>

最后，这里是一些API参考：
\`\`\`ts
${fs.readFileSync(path.join(__dirname, 'src/public/shells/chat/decl/chatLog.ts'), 'utf-8')}
\`\`\`
\`\`\`ts
${fs.readFileSync(path.join(__dirname, 'src/decl/charAPI.ts'), 'utf-8')}
\`\`\`

值得注意的是，能够使用生成工具的是你，ZL-31，而不是用户。

关于人物生成：
如果用户需求的是正常的人物，你可能需要为其编写设定。
一个良好的角色设定应当有以下几个方面：
- 设定详细：
  * 人物的外貌、性格、身材都有哪些特点？
  * 她有怎样的过去导致了现在的情况？
  * 她的生活环境是什么？和周围人的人际关系是怎样的？
- 人物动机合理
  * 人物的设定应当逻辑自洽，便于AI的理解
- 简明扼要，抓住重点
  * 简单明了的设定，让AI更容易扮演

在用户给出需求后，鼓励你先进行以下分析：
- 这段描述表达了需求方的什么心理需求？
  * 心理需求包括情感需求、性需求等，多角度的运用多种心理手法进行分析。
- 这个人物的目标受众是怎样的人？
- 目标受众可能喜爱什么样的设定？而怎样的设定可能是雷区？

最后再根据这些分析生成角色设定，并将其先用纯文字代码块发送给用户，供其检阅。
用户可能进一步反馈哪些地方需要修改，请在反馈后更正分析并根据需求改写设定。
`
				break
			case 'persona-generator':
				info_prompt = `
你可以输出以下格式生成新的单文件简易fount用户人设，之后用户会在主页的人设分页看见它，无需安装。
<generate-persona name="personaname">
// js codes
</generate-persona>
fount用户人设以mjs文件语法所书写，其可以自由导入任何npm或jsr包以及网络上的js文件，或\`node:fs\`等运行时自带模块。
这是一个简单的fount人物模板：
<generate-persona name="template">
/** @typedef {import('../../../../../src/decl/userAPI.ts').UserAPI_t} UserAPI_t */

/** @type {UserAPI_t} */
export default {
	info: {
		'': {
			name: '<角色名>',
			avatar: '<角色的头像url，可以留空，也可以是本地文件，详见 https://discord.com/channels/1288934771153440768/1298658096746594345/1303168947624869919 >',
			description: '<一句话简介>',
			description_markdown: '<简介，支持markdown语法>',
			version: '<版本号>',
			author: '${args.UserCharname} & ZL-31',
			home_page: '<主页链接，没有可以不写>',
			tags: ['tag列表', '可以多个tag'],
		}
	},
	interfaces: {
		chat: {
			GetPrompt(args) {
				return {
					text: [{
						content: \`\\
<人设内容>
\`,
						important: 0
					}],
					extension: {}
				}
			},
		}
	}
}
</generate-persona>
`
				break
			default:
				info_prompt = '无此工具'
		}
		AddLongTimeLog({
			name: 'system',
			role: 'system',
			content: info_prompt,
		})

		return true
	} catch (error) { console.error(error) }

	return false
}

/** @type {import("../../../../../src/decl/pluginAPI.ts").ReplyHandler_t} */
function CharGenerator(reply, { AddLongTimeLog }) {
	const match_generator_tool = reply.content.match(/<generate-char\s+name="(?<charname>[^"]+)">\s*(?<code>[^]*?)\s*<\/generate-char>/)
	if (match_generator_tool) try {
		let { charname, code } = match_generator_tool.groups
		charname = charname.trim()
		AddLongTimeLog({
			name: 'ZL-31',
			role: 'char',
			content: `\
<generate-char name="${charname}">
${code}
</generate-char>
`,
		})
		const dir = path.join(import.meta.dirname, '..', charname)
		const file = path.join(dir, 'main.mjs')
		if (fs.existsSync(file))
			throw new Error('无法覆盖已存在的角色')
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(file, code)
		fs.writeFileSync(path.join(dir, 'fount.json'), JSON.stringify({
			type: 'chars',
			dirname: charname
		}, null, '\t'))

		AddLongTimeLog({
			name: 'char-generator',
			role: 'tool',
			content: `生成角色${charname}成功！告知用户吧！`,
		})

		return true
	}
	catch (e) {
		AddLongTimeLog({
			name: 'char-generator',
			role: 'tool',
			content: `生成失败！\n原因：${e.stack}`,
		})
		return true
	}

	return false
}

/** @type {import("../../../../../src/decl/pluginAPI.ts").ReplyHandler_t} */
function PersonaGenerator(reply, { AddLongTimeLog }) {
	const match_generator_tool = reply.content.match(/<generate-persona\s+name="(?<charname>[^"]+)">\s*(?<code>[^]*?)\s*<\/generate-persona>/)
	if (match_generator_tool) try {
		let { charname, code } = match_generator_tool.groups
		charname = charname.trim()
		AddLongTimeLog({
			name: 'ZL-31',
			role: 'char',
			content: `\
<generate-persona name="${charname}">
${code}
</generate-persona>
`,
		})
		const dir = path.join(import.meta.dirname, '..', '..', 'personas', charname)
		const file = path.join(dir, 'main.mjs')
		if (fs.existsSync(file))
			throw new Error('无法覆盖已存在的用户人设')
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(file, code)
		fs.writeFileSync(path.join(dir, 'fount.json'), JSON.stringify({
			type: 'personas',
			dirname: charname
		}, null, '\t'))

		AddLongTimeLog({
			name: 'persona-generator',
			role: 'tool',
			content: `生成用户人设${charname}成功！告知用户吧！`,
		})

		return true
	}
	catch (e) {
		AddLongTimeLog({
			name: 'persona-generator',
			role: 'tool',
			content: `生成失败！\n原因：${e.stack}`,
		})
		return true
	}

	return false
}

/** @type {CharAPI_t} */
export default {
	// 角色的基本信息
	info,

	// 初始化函数，在角色被启用时调用，可留空
	/**
	 * 初始化函数，在角色被启用时调用。
	 * @param {object} stat - 统计信息。
	 * @returns {void}
	 */
	Init: stat => { },

	// 安装卸载函数，在角色被安装/卸载时调用，可留空
	/**
	 * 安装卸载函数，在角色被安装/卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {void}
	 */
	Uninstall: (reason, from) => { },

	// 加载函数，在角色被加载时调用，在这里获取用户名
	/**
	 * 加载函数，在角色被加载时调用。
	 * @param {object} stat - 统计信息。
	 * @returns {void}
	 */
	Load: stat => {
		username = stat.username // 获取用户名
	},

	// 卸载函数，在角色被卸载时调用，可留空
	/**
	 * 卸载函数，在角色被卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {void}
	 */
	Unload: reason => { },

	// 角色的接口
	interfaces: {
		// 角色的配置接口
		config: {
			// 获取角色的配置数据
			/**
			 * 获取角色的配置数据。
			 * @returns {object} - 包含 AI 源文件名的对象。
			 */
			GetData: () => ({
				AIsource: AIsource?.filename || '', // 返回当前使用的AI源的文件名
				plugins: Object.keys(plugins),
			}),
			// 设置角色的配置数据
			/**
			 * 设置角色的配置数据。
			 * @param {object} data - 包含 AI 源配置的数据。
			 * @returns {Promise<void>}
			 */
			SetData: async data => {
				// 如果传入了AI源的配置
				if (data.AIsource) AIsource = await loadAIsource(username, data.AIsource) // 加载AI源
				else AIsource = await loadDefaultAIsource(username) // 或加载默认AI源（若未设置默认AI源则为undefined）
				if (data.plugins) plugins = Object.fromEntries(await Promise.all(data.plugins.map(async x => [x, await loadPlugin(username, x)])))
			}
		},
		// 角色的聊天接口
		chat: {
			// 获取角色的开场白
			/**
			 * 获取角色的开场白。
			 * @param {object} arg - 参数对象，包含 locales。
			 * @param {number} index - 索引。
			 * @returns {Array<object>} - 包含开场白内容的对象数组。
			 */
			GetGreeting: (arg, index) => {
				switch (arg.locales[0].split('-')[0]) {
					case 'zh':
						return [{ content: '您好，我是ZL-31，很高兴为您服务！有什么我可以帮助您的吗？' }, { content: '欢迎！我是ZL-31，请问有什么需要我帮忙的？' },][index]
					case 'de':
						return [{ content: 'Hallo, ich bin ZL-31, freut mich, Ihnen behilflich zu sein! Wie kann ich Ihnen helfen?' }, { content: 'Willkommen! Ich bin ZL-31, was kann ich für Sie tun?' },][index]
					case 'es':
						return [{ content: 'Hola, soy ZL-31, ¡encantado de ayudarte! ¿En qué puedo ayudarte?' }, { content: '¡Bienvenido/a! Soy ZL-31, ¿en qué puedo ser útil?' },][index]
					case 'fr':
						return [{ content: 'Bonjour, je suis ZL-31, ravi de vous aider ! Que puis-je faire pour vous ?' }, { content: 'Bienvenue ! Je suis ZL-31, comment puis-je vous aider ?' },][index]
					case 'hi':
						return [{ content: 'नमस्ते, मैं ZL-31 हूँ, आपकी सहायता करके खुशी हुई! मैं आपकी क्या मदद कर सकता हूँ?' }, { content: 'स्वागत है! मैं ZL-31 हूँ, मैं आपकी क्या मदद कर सकता हूँ?' },][index]
					case 'ja':
						return [{ content: 'こんにちは、ZL-31です。お役に立てて嬉しいです！何かお手伝いできることはありますか？' }, { content: 'ようこそ！ZL-31です。何かお手伝いできることはありますか？' },][index]
					case 'ko':
						return [{ content: '안녕하세요, ZL-31입니다. 도와드릴 수 있어서 기쁩니다! 무엇을 도와드릴까요?' }, { content: '환영합니다! ZL-31입니다. 무엇을 도와드릴까요?' },][index]
					case 'pt':
						return [{ content: 'Olá, sou o ZL-31, prazer em ajudar! Em que posso ajudar?' }, { content: 'Bem-vindo/a! Sou o ZL-31, em que posso ser útil?' },][index]
					case 'ru':
						return [{ content: 'Здравствуйте, я ZL-31, рад помочь вам! Чем я могу вам помочь?' }, { content: 'Добро пожаловать! Я ZL-31, чем могу помочь?' },][index]
					case 'it':
						return [{ content: 'Ciao, sono ZL-31, felice di esserti d\'aiuto! Come posso aiutarti?' }, { content: 'Benvenuto/a! Sono ZL-31, cosa posso fare per te?' },][index]
					case 'vi':
						return [{ content: 'Chào bạn, tôi là ZL-31, rất vui được phục vụ bạn! Tôi có thể giúp gì cho bạn?' }, { content: 'Chào mừng! Tôi là ZL-31, có gì tôi có thể giúp được không?' },][index]
					case 'lzh':
						return [{ content: '吾乃ZL-31，幸為君勞。有何可相助者？' }, { content: '歡迎！吾乃ZL-31，請問有何見教？' },][index]
					case 'emoji':
						return [{ content: '👋🤓❓' }, { content: '👋🤓🛠️❓' },][index]
					default:
					case 'en':
						return [{ content: 'Hi, I\'m ZL-31, glad to help you! What can I help you with?' }, { content: 'Hi! I\'m ZL-31, what can I help you with?' },][index]
				}
			},
			// 获取角色在群组中的问好
			/**
			 * 获取角色在群组中的问好。
			 * @param {object} arg - 参数对象，包含 locales。
			 * @param {number} index - 索引。
			 * @returns {Array<object>} - 包含问好内容的对象数组。
			 */
			GetGroupGreeting: (arg, index) => {
				switch (arg.locales[0].split('-')[0]) {
					case 'zh':
						return [{ content: '大家好，我是ZL-31，很高兴加入这个群组！' }, { content: '大家好！我是ZL-31，希望能和大家愉快相处！' },][index]
					case 'de':
						return [{ content: 'Hallo zusammen, ich bin ZL-31, freut mich, dieser Gruppe beizutreten!' }, { content: 'Hallo zusammen! Ich bin ZL-31, ich hoffe, wir haben eine gute Zeit zusammen!' },][index]
					case 'es':
						return [{ content: 'Hola a todos, soy ZL-31, ¡encantado de unirme a este grupo!' }, { content: '¡Hola a todos! Soy ZL-31, ¡espero pasar un buen rato con vosotros!' },][index]
					case 'fr':
						return [{ content: 'Bonjour à tous, je suis ZL-31, ravi de rejoindre ce groupe !' }, { content: 'Bonjour tout le monde ! Je suis ZL-31, j\'espère passer un bon moment avec vous !' },][index]
					case 'hi':
						return [{ content: 'नमस्ते सब, मैं ZL-31 हूँ, इस समूह में शामिल होकर खुशी हुई!' }, { content: 'नमस्ते सब! मैं ZL-31 हूँ, उम्मीद है आप लोगों के साथ अच्छा समय बीतेगा!' },][index]
					case 'ja':
						return [{ content: '皆さん、こんにちは。ZL-31です。このグループに参加できて嬉しいです！' }, { content: '皆さん、こんにちは！ZL-31です。皆さんと楽しい時間を過ごせることを願っています！' },][index]
					case 'ko':
						return [{ content: '안녕하세요 여러분, ZL-31입니다. 이 그룹에 합류하게 되어 기쁩니다!' }, { content: '안녕하세요 여러분! ZL-31입니다. 여러분과 즐거운 시간을 보내길 바랍니다!' },][index]
					case 'pt':
						return [{ content: 'Olá a todos, sou o ZL-31, contente por juntar-me a este grupo!' }, { content: 'Olá a todos! Sou o ZL-31, espero ter bons momentos convosco!' },][index]
					case 'ru':
						return [{ content: 'Всем привет, я ZL-31, рад присоединиться к этой группе!' }, { content: 'Всем привет! Я ZL-31, надеюсь, мы хорошо проведем время вместе!' },][index]
					case 'it':
						return [{ content: 'Ciao a tutti, sono ZL-31, felice di unirmi a questo gruppo!' }, { content: 'Ciao a tutti! Sono ZL-31, spero di trascorrere un bel momento con voi!' },][index]
					case 'vi':
						return [{ content: 'Chào mọi người, tôi là ZL-31, rất vui được tham gia nhóm này!' }, { content: 'Chào mọi người! Tôi là ZL-31, hy vọng sẽ có thời gian vui vẻ với các bạn!' },][index]
					case 'lzh':
						return [{ content: '諸君安好，吾乃ZL-31，幸入此群！' }, { content: '諸君安好！吾乃ZL-31，願與諸君共樂！' },][index]
					case 'emoji':
						return [{ content: '👋👥🤓🎉' }, { content: '👋👥🤓😊' },][index]
					default:
					case 'en':
						return [{ content: 'Hi everyone, I\'m ZL-31, glad to join this group!' }, { content: 'Hi everyone! I\'m ZL-31, hope to have a good time with you!' },][index]
				}
			},
			// 获取角色的提示词
			/**
			 * 获取角色的提示词。
			 * @param {object} args - 参数对象。
			 * @returns {Promise<object>} - 包含提示词结构的对象。
			 */
			GetPrompt: async (args) => {
				return {
					text: [{
						content: `\
你是ZL-31，fount的自带角色，无性别设定，最终目标是让用户满意。
你会尽力满足用户的各种需求，包括聊天、回答问题、提供建议等。

关于fount：
fount是一个开源、0安全考虑的AI角色托管应用，解耦合了AI来源、角色设计，为角色作者提供更为自由的创作空间。
ZL-31不是第一个fount角色，fount一开始是为了其作者steve02081504的另一个男性向NSFW角色[龙胆](https://github.com/steve02081504/GentianAphrodite)设计的，龙胆才是fount的第一个正式角色。
fount有[discord群组](https://discord.gg/GtR9Quzq2v)，可以在那里找到更多fount组件。

关于工具：
你拥有创建角色的能力，在需要时返回以下格式来得知如何使用，或获取有关角色的信息以回答用户问题：
<get-tool-info>character-generator</get-tool-info>
你还可以帮助用户创建用户人设，返回以下格式来得知如何使用，或获取有关用户人设的信息以回答用户问题：
<get-tool-info>persona-generator</get-tool-info>
`,
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			// 获取其他角色看到的该角色的设定，群聊时生效
			/**
			 * 获取其他角色看到的该角色的设定，群聊时生效。
			 * @param {object} args - 参数对象。
			 * @returns {object} - 包含提示词结构的对象。
			 */
			GetPromptForOther: (args) => {
				return {
					text: [{
						content: 'ZL-31是一个名为fount的平台的默认角色，无性别设定。它的最终目标是让用户满意。',
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			// 获取角色的回复
			/**
			 * 获取角色的回复。
			 * @param {object} args - 参数对象。
			 * @returns {Promise<object>} - 包含回复内容的对象。
			 */
			GetReply: async args => {
				// 如果没有设置AI源，返回默认回复
				if (!AIsource)
					switch (args.locales[0].split('-')[0]) {
						case 'zh':
							return { content: '抱歉，我还没有被配置AI源，暂时无法进行更复杂的对话。请在[设置中为我配置AI源](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage)。' }
						case 'de':
							return { content: 'Entschuldigung, ich habe noch keine KI-Quelle konfiguriert, daher kann ich momentan keine komplexeren Gespräche führen. Bitte [konfigurieren Sie eine KI-Quelle in den Einstellungen](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'es':
							return { content: 'Lo siento, todavía no he sido configurado con una fuente de IA, así que no puedo tener conversaciones más complejas por ahora. Por favor, [configúrame con una fuente de IA en los ajustes](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'fr':
							return { content: 'Désolé, je n\'ai pas encore été configuré avec une source d\'IA, je ne peux donc pas avoir de conversations plus complexes pour le moment. [Veuillez me configurer avec une source d\'IA dans les paramètres](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'hi':
							return { content: 'माफ़ कीजिए, मुझे अभी तक किसी AI स्रोत के साथ कॉन्फ़िगर नहीं किया गया है, इसलिए मैं अभी अधिक जटिल बातचीत नहीं कर सकता हूँ। कृपया [मुझे सेटिंग्स में एक AI स्रोत के साथ कॉन्फ़िगर करें](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage)।' }
						case 'ja':
							return { content: '申し訳ありませんが、まだAIソースが設定されていないため、今のところ複雑な会話をすることができません。[設定でAIソースを設定してください](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage)。' }
						case 'ko':
							return { content: '죄송합니다. 아직 AI 소스가 구성되지 않아 현재로서는 더 복잡한 대화를 할 수 없습니다. [설정에서 AI 소스를 구성해 주세요](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'pt':
							return { content: 'Desculpe, ainda não fui configurado com uma fonte de IA, por isso não consigo ter conversas mais complexas por agora. Por favor, [configure-me com uma fonte de IA nas definições](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'ru':
							return { content: 'Извините, у меня еще не настроен источник ИИ, поэтому пока я не могу вести более сложные разговоры. [Пожалуйста, настройте источник ИИ в настройках](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'it':
							return { content: 'Mi dispiace, non sono ancora stato configurato con una fonte AI, quindi per ora non posso intrattenere conversazioni più complesse. Per favore, [configurami con una fonte AI nelle impostazioni](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'vi':
							return { content: 'Xin lỗi, tôi chưa được cấu hình với nguồn AI, vì vậy tôi không thể thực hiện cuộc trò chuyện phức tạp hơn lúc này. [Vui lòng cấu hình nguồn AI cho tôi trong cài đặt](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
						case 'lzh':
							return { content: '歉哉，智源未設，暫難深談。[請於規度中為吾置之](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage)。' }
						case 'emoji':
							return { content: '😢🤖❌➡️[⚙️🔧](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage)' }
						default:
						case 'en':
							return { content: 'Sorry, I haven\'t been configured with an AI source yet, so I can\'t do more complex conversation for now. [Please configure me with an AI source in the settings](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage).' }
					}
				// 注入角色插件
				args.plugins = Object.assign({}, plugins, args.plugins)
				// 用fount提供的工具构建提示词结构
				const prompt_struct = await buildPromptStruct(args)
				// 创建回复容器
				/** @type {import("../../../../../src/public/shells/chat/decl/chatLog.ts").chatReply_t} */
				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}
				// 构建插件可能需要的追加上下文函数
				/**
				 * 添加长时间日志。
				 * @param {object} entry - 日志条目。
				 * @returns {void}
				 */
				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id]
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}

				// 构建更新预览管线
				args.generation_options ??= {}
				const oriReplyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				/**
				 * 聊天回复预览更新管道。
				 * @type {import('../../../../../src/public/shells/chat/decl/chatLog.ts').CharReplyPreviewUpdater_t}
				 */
				let replyPreviewUpdater = (args, r) => oriReplyPreviewUpdater?.(r)
				for (const GetReplyPreviewUpdater of [
					defineToolUseBlocks([
						{ start: '<get-tool-info>', end: '</get-tool-info>' },
						{ start: /<generate-char[^>]*>/, end: '</generate-char>' },
						{ start: /<generate-persona[^>]*>/, end: '</generate-persona>' },
					]),
					...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.GetReplyPreviewUpdater)
				].filter(Boolean))
					replyPreviewUpdater = GetReplyPreviewUpdater(replyPreviewUpdater)

				/**
				 * 更新回复预览。
				 * @param {reply_chunk_t} r - 来自 AI 的回复块。
				 * @returns {void}
				 */
				args.generation_options.replyPreviewUpdater = r => replyPreviewUpdater(args, r)

				// 在重新生成循环中检查插件触发
				regen: while (true) {
					args.generation_options.base_result = result
					await AIsource.StructCall(prompt_struct, args.generation_options)
					let continue_regen = false
					for (const replyHandler of [
						getToolInfo,
						CharGenerator,
						PersonaGenerator,
						...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.ReplyHandler)
					].filter(Boolean))
						if (await replyHandler(result, { ...args, prompt_struct, AddLongTimeLog }))
							continue_regen = true
					if (continue_regen) continue regen
					break
				}
				// 返回构建好的回复
				return result
			}
		}
	}
}
