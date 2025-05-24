import fs from 'node:fs'
import path from 'node:path'
import { loadAIsource } from '../../../../../src/server/managers/AIsources_manager.mjs' // 调整路径
import { saveJsonFile } from '../../../../../src/scripts/json_loader.mjs' // 调整路径
import { promptBuilder } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/prompt_builder.mjs' // 复用ST引擎
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/server/prompt_struct.mjs' // 调整路径
import { runRegex } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/regex.mjs' // 复用ST引擎
import { regex_placement } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/charData.mjs' // 复用ST引擎
import { evaluateMacros } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/marco.mjs' // 复用ST引擎
// 复用ST引擎 (getCharacterSource可能需要调整或我们直接用转换时存的source_url)

/** @typedef {import('../../../../../src/decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../src/public/ImportHandlers/SillyTavern/engine/charData.mjs').v2CharData} chardata_t */

/** @type {AIsource_t} */
let AIsource = null
let username = ''

const chardir = import.meta.dirname
// Fount 的资源 URL 格式，确保 charname 部分已正确编码
const charnameForUrl = encodeURIComponent(path.basename(chardir))
const charurl = `/chars/${charnameForUrl}`
const charjson = path.join(chardir, 'chardata.json')

/** @type {chardata_t} */
let chardata = JSON.parse(fs.readFileSync(charjson, 'utf-8'))

// Helper for macro evaluation environment
function getMacroEnv(userCharName) {
	return {
		char: chardata.extensions?.ccv3_nickname || chardata.name, // 使用 CCv3 nickname (如果存在)
		user: userCharName || 'User',
		model: AIsource?.filename || 'default_model', // AI源可能在info构建时尚未加载，提供默认值
		charVersion: chardata.character_version,
		char_version: chardata.character_version,
	}
}

// 函数：构建国际化的 info 对象
function buildCharInfo(charData) {
	const info = {}
	// Fount 的默认语言键通常是 '' 或特定语言如 'en'。CCv3 使用 ISO 639-1 ('en', 'zh').
	// 我们将使用 CCv3 的语言代码作为键，并为 '' 设置一个后备。
	const defaultLocaleKey = '' // Fount 使用的默认/后备 locale key

	// --- 辅助函数：为特定语言创建 info 对象 ---
	const createInfoForLang = (note) => {
		// 注意：chardata.creator_notes 已经是经过 evaluateMacros 的（如果ST的宏在其中）
		// 但CCv3的creator_notes通常是纯文本，宏处理应在显示时。
		// 因此，这里我们直接使用 note，宏将在Fount显示时处理（如果Fount的UI层面支持）。
		// 或者，如果希望在导入时就评估宏，则调用 evaluateMacros。
		// 为保持与原模板一致（原模板在info中评估宏），我们也在这里评估。
		const evaluatedNote = evaluateMacros(note || '', getMacroEnv('User')) // 'User' 作为占位符
		return {
			name: charData.name, // CCv3 name 字段不是多语言的
			avatar: `${charurl}/image.png`, // 头像路径固定
			description: evaluatedNote.split('\n')[0] || 'No description.', // 取第一行作为简短描述
			description_markdown: evaluatedNote || 'No description.', // 完整描述
			version: charData.character_version || '1.0.0',
			author: charData.creator || 'Unknown',
			homepage: charData.extensions?.source_url || '',
			tags: charData.tags || [],
		}
	}

	// --- 步骤1: 设置默认/后备语言信息 (使用 chardata.creator_notes) ---
	// chardata.creator_notes 是转换器根据 userLanguage 或 'en' 选定的单语言笔记
	info[defaultLocaleKey] = createInfoForLang(charData.creator_notes)

	// --- 步骤2: 从 chardata.extensions.creator_notes_multilingual 填充其他语言信息 ---
	if (charData.extensions?.creator_notes_multilingual && typeof charData.extensions.creator_notes_multilingual === 'object')
		for (const langCode in charData.extensions.creator_notes_multilingual)
			if (Object.hasOwnProperty.call(charData.extensions.creator_notes_multilingual, langCode)) {
				const noteForLang = charData.extensions.creator_notes_multilingual[langCode]
				// Fount 的 locale 通常是 'en-US', 'zh-CN' 等。CCv3 的是 'en', 'zh'。
				// 直接使用 CCv3 的 langCode。Fount 在查找时应能处理 'en' 匹配 'en-US' 的情况。
				if (langCode !== defaultLocaleKey)  //避免覆盖已经由 `chardata.creator_notes` 设置的默认条目
					info[langCode] = createInfoForLang(noteForLang)
				else if (!info[defaultLocaleKey].description_markdown && noteForLang)
				// 如果默认条目的描述为空（可能 chardata.creator_notes 为空），但多语言中有对应默认键的有效条目，则使用它
					info[defaultLocaleKey] = createInfoForLang(noteForLang)
			}


	// 如果 Fount 强制要求 'en' 存在，且 '' 不是 'en' 的有效代理，可以在这里确保 'en' 条目
	if (!info.en && info[''] && chardata.creator_notes === (chardata.extensions?.creator_notes_multilingual?.en || chardata.creator_notes) ) {
		// 如果 '' 的内容实际上是英文内容，并且没有显式的 'en'，可以考虑复制一份
		// 但更好的做法是让Fount的locale匹配机制处理 '' 和 'en'
	}


	return info
}

/**
 * @param {string} text
 * @returns {string}
 */
function formatRisuOutput(text) {
	const risu_assets = chardata.extensions?.risu_assets || []
	return text.replace(/<img="(?<src>[^"]+)">/g, (match, src) => {
		const asset = risu_assets.find(a => a.name == src) || risu_assets.find(a => a.name == `${src}.${a.ext}`)
		return `<img src="${charurl}/${asset.fount_uri}" class="modal-img">`
	})
}


/** @type {charAPI_t} */
const charAPI_definition = { // 先定义结构主体
	info: {}, // 将由 buildCharInfo 动态填充

	Init: () => { },
	Uninstall: () => { },
	Load: (stat) => {
		username = stat.username
		// 可以在这里尝试加载与角色绑定的AI源，如果chardata.extensions中有记录
		if (chardata.extensions?.default_aisource)
			loadAIsource(username, chardata.extensions.default_aisource)
				.then(ai => { AIsource = ai })
				.catch(err => console.warn(`Failed to autoload AI source ${chardata.extensions.default_aisource}: ${err.message}`))
	},
	Unload: () => {
		AIsource = null
		username = ''
	},

	interfaces: {
		config: {
			GetData: () => ({
				AIsource: AIsource?.filename || '',
				chardata, // STv2 格式
			}),
			SetData: async (data) => {
				if (data.chardata) {
					chardata = data.chardata
					charAPI_definition.info = buildCharInfo(chardata)
					saveJsonFile(charjson, chardata) // 保存 STv2 格式
				}
				if (data.AIsource) {
					AIsource = await loadAIsource(username, data.AIsource)
					// 可以考虑将选择的AI源保存到 chardata.extensions.default_aisource
					chardata.extensions.default_aisource = data.AIsource
					saveJsonFile(charjson, chardata)
				}
			}
		},
		chat: {
			GetGreeting: (args, index) => {
				// CCv3 的 first_mes 和 alternate_greetings 不是多语言结构，直接使用 chardata 中的版本
				const greetings = [
					chardata?.first_mes,
					...chardata?.alternate_greetings || []
				].filter(g => typeof g === 'string' && g.trim() !== '')

				if (greetings.length === 0) greetings.push(`Hello, I am ${chardata.name}.`) // 默认问候
				if (index < 0 || index >= greetings.length) index = 0 // 安全索引

				const selectedGreeting = greetings[index]
				const env = getMacroEnv(args.UserCharname) // args.UserCharname 来自 Fount 调用 GetGreeting 时的参数
				const result = evaluateMacros(selectedGreeting, env, args.chat_scoped_char_memory, args.chat_log)

				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: formatRisuOutput(runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly))
				}
			},
			GetGroupGreeting: (args, index) => {
				// CCv3 的 group_only_greetings 被放到了 chardata.extensions.group_greetings
				// 这同样不是一个多语言结构
				const groupGreetings = (chardata.extensions?.group_greetings || []).filter(g => typeof g === 'string' && g.trim() !== '')

				if (groupGreetings.length === 0)  // 如果没有专门的群组问候，可以使用常规问候
					return charAPI_definition.interfaces.chat.GetGreeting(args, index) // 注意：这里要用 charAPI_definition 引用

				if (index < 0 || index >= groupGreetings.length) index = 0

				const selectedGreeting = groupGreetings[index]
				const env = getMacroEnv(args.UserCharname)
				// 注意：ST 的 group 宏可能需要特殊处理，env.group
				env.group = args.GroupName || 'Group' // 假设 args 包含 GroupName
				const result = evaluateMacros(selectedGreeting, env, args.chat_scoped_char_memory, args.chat_log)

				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: formatRisuOutput(runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly))
				}
			},
			GetPrompt: (promptArgs /* Fount prompt_struct_args_t */) => {
				// 确保传递给 promptBuilder 的 Charname 是我们期望的（考虑 nickname）
				const effectiveCharName = chardata.extensions?.ccv3_nickname || chardata.name
				const builderArgs = {
					...promptArgs,
					Charname: effectiveCharName, // 覆盖传入的 Charname
				}
				return promptBuilder(builderArgs, chardata, AIsource?.filename || 'default_model')
			},
			GetReply: async (args) => {
				if (!AIsource)
					return {
						// 此处的提示可以考虑根据 args.locales 进行 i18n，但属于模板细节优化
						content: 'This character does not have an AI source. Please set the AI source in the character config first.'
					}


				const effectiveCharName = chardata.extensions?.ccv3_nickname || chardata.name
				const promptStructArgs = { ...args, char_name: effectiveCharName } // 确保 buildPromptStruct 使用正确的角色名
				const prompt_struct = await buildPromptStruct(promptStructArgs)

				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}

				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id] // char_id 来自 Fount 的参数
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}

				regen_loop: while (true) {
					const requestResult = await AIsource.StructCall(prompt_struct, args.chat_id, args.message_id)
					result.content = requestResult.content
					result.files = (result.files || []).concat(requestResult.files || [])
					result.extension = { ...result.extension, ...requestResult.extension }

					// 插件处理逻辑 (如果你的Fount系统有插件)
					const plugins = args.plugins || {} // 从 Fount 运行时获取
					for (const plugin of Object.values(plugins))
						if (plugin?.interfaces?.chat?.ReplyHandler) {
							const handled = await plugin.interfaces.chat.ReplyHandler(result, { ...args, prompt_struct, AddLongTimeLog })
							if (handled) continue regen_loop
						}

					break // 正常结束
				}

				const env = getMacroEnv(args.UserCharname)
				const finalContent = evaluateMacros(result.content, env, args.chat_scoped_char_memory, args.chat_log)

				return {
					content: runRegex(chardata, finalContent, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: formatRisuOutput(runRegex(chardata, finalContent, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly)),
					files: result.files,
					extension: result.extension,
				}
			},
			GetReplyFrequency: async (args) => {
				if (chardata.extensions && typeof chardata.extensions.talkativeness === 'number')
					return Math.max(0.1, Number(chardata.extensions.talkativeness) * 2) // ST 逻辑

				return 1 // 默认频率
			},
			MessageEdit: (args) => {
				const env = getMacroEnv(args.UserCharname) // UserCharname可能需要从args的上下文中获取
				const editedContent = evaluateMacros(args.edited.content, env, args.chat_scoped_char_memory, args.chat_log)
				return {
					...args.edited,
					content: runRegex(chardata, editedContent, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly && (e.runOnEdit !== false)),
					content_for_show: formatRisuOutput(runRegex(chardata, editedContent, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly && (e.runOnEdit !== false))),
				}
			}
		}
	}
}

// 在模块加载时填充 info 对象
charAPI_definition.info = buildCharInfo(chardata)

export default charAPI_definition // 导出定义好的对象
