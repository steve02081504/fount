import fs from 'node:fs'
import path from 'node:path'

import { regex_placement } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/charData.mjs' // 复用ST引擎
import { evaluateMacros } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/marco.mjs' // 复用ST引擎
import { promptBuilder } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/prompt_builder.mjs' // 复用ST引擎
import { runRegex } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/regex.mjs' // 复用ST引擎
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/prompt_struct.mjs' // 调整路径
import { saveJsonFile } from '../../../../../src/scripts/json_loader.mjs' // 调整路径
import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs' // 调整路径
// 复用ST引擎 (getCharacterSource可能需要调整或我们直接用转换时存的source_url)

/** @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../src/public/ImportHandlers/SillyTavern/engine/charData.mjs').v2CharData} chardata_t */

/** @type {AIsource_t} */
let AIsource = null
let username = ''

const chardir = import.meta.dirname
// fount 的资源 URL 格式，确保 charname 部分已正确编码
const charnameForUrl = encodeURIComponent(path.basename(chardir))
const charurl = `/chars/${charnameForUrl}`
const charjson = path.join(chardir, 'chardata.json')

/** @type {chardata_t} */
let chardata = JSON.parse(fs.readFileSync(charjson, 'utf-8'))

// Helper for macro evaluation environment
/**
 * 获取宏环境
 * @param {any} userCharName 用户角色名
 * @returns {{ char: any; user: any; model: any; charVersion: string; char_version: string; }} 包含宏评估所需变量的对象
 */
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
/**
 * 构建角色信息
 * @param {any} charData 角色数据
 * @returns {{}} 包含角色信息的对象
 */
function buildCharInfo(charData) {
	const info = {}
	// fount 的默认语言键通常是 '' 或特定语言如 'en'。CCv3 使用 ISO 639-1 ('en', 'zh').
	// 我们将使用 CCv3 的语言代码作为键，并为 '' 设置一个后备。
	const defaultLocaleKey = '' // fount 使用的默认/后备 locale key

	// --- 辅助函数：为特定语言创建 info 对象 ---
	/**
	 * 为语言创建信息
	 * @param {any} note 注释
	 * @returns {{ name: any; avatar: string; description: any; description_markdown: any; version: any; author: any; home_page: any; tags: any; }} 包含角色信息的对象
	 */
	const createInfoForLang = note => {
		// 注意：chardata.creator_notes 已经是经过 evaluateMacros 的（如果ST的宏在其中）
		// 但CCv3的creator_notes通常是纯文本，宏处理应在显示时。
		// 因此，这里我们直接使用 note，宏将在fount显示时处理（如果fount的UI层面支持）。
		// 或者，如果希望在导入时就评估宏，则调用 evaluateMacros。
		// 为保持与原模板一致（原模板在info中评估宏），我们也在这里评估。
		const evaluatedNote = evaluateMacros(note || '', getMacroEnv('User')) // 'User' 作为占位符
		return {
			name: charData.name, // CCv3 name 字段不是多语言的
			avatar: `${charurl}/image.png`, // 头像路径固定
			description: evaluatedNote.split('\n')[0] || 'No description.', // 取第一行作为简短描述
			description_markdown: evaluatedNote || 'No description.', // 完整描述
			version: charData.character_version || '0.0.1',
			author: charData.creator || 'Unknown',
			home_page: charData.extensions?.source_url || '',
			tags: charData.tags || [],
		}
	}

	// --- 步骤1: 设置默认/后备语言信息 (使用 chardata.creator_notes) ---
	// chardata.creator_notes 是转换器根据 userLanguage 或 'en' 选定的单语言笔记
	info[defaultLocaleKey] = createInfoForLang(charData.creator_notes)

	// --- 步骤2: 从 chardata.extensions.creator_notes_multilingual 填充其他语言信息 ---
	if (charData.extensions?.creator_notes_multilingual)
		for (const langCode in charData.extensions.creator_notes_multilingual)
			if (Object.hasOwnProperty.call(charData.extensions.creator_notes_multilingual, langCode)) {
				const noteForLang = charData.extensions.creator_notes_multilingual[langCode]
				// fount 的 locale 通常是 'en-US', 'zh-CN' 等。CCv3 的是 'en', 'zh'。
				// 直接使用 CCv3 的 langCode。fount 在查找时应能处理 'en' 匹配 'en-US' 的情况。
				if (langCode !== defaultLocaleKey)  //避免覆盖已经由 `chardata.creator_notes` 设置的默认条目
					info[langCode] = createInfoForLang(noteForLang)
				else if (!info[defaultLocaleKey].description_markdown && noteForLang)
					// 如果默认条目的描述为空（可能 chardata.creator_notes 为空），但多语言中有对应默认键的有效条目，则使用它
					info[defaultLocaleKey] = createInfoForLang(noteForLang)
			}


	// 如果 fount 强制要求 'en' 存在，且 '' 不是 'en' 的有效代理，可以在这里确保 'en' 条目
	if (!info.en && info[''] && chardata.creator_notes === (chardata.extensions?.creator_notes_multilingual?.en || chardata.creator_notes)) {
		// 如果 '' 的内容实际上是英文内容，并且没有显式的 'en'，可以考虑复制一份
		// 但更好的做法是让fount的locale匹配机制处理 '' 和 'en'
	}


	return info
}

/**
 * @param {string} text 要格式化的文本
 * @returns {string} 格式化后的文本
 */
function formatRisuOutput(text) {
	const risu_assets = chardata.extensions?.risu_assets || []
	return text.replace(/<img="(?<src>[^"]+)">/g, (match, src) => {
		const asset = risu_assets.find(a => a.name == src) || risu_assets.find(a => a.name == `${src}.${a.ext}`)
		return /* html */ `<img src="${charurl}/${asset.fount_uri}" class="modal-img">`
	})
}


/** @type {CharAPI_t} */
const charAPI_definition = { // 先定义结构主体
	info: {}, // 将由 buildCharInfo 动态填充

	/**
	 * 加载
	 * @param {any} stat 状态
	 */
	Load: stat => {
		username = stat.username
	},

	interfaces: {
		config: {
			/**
			 * 获取数据
			 * @returns {{ AIsource: any; chardata: chardata_t; }} 包含 AI 源和角色数据的对象
			 */
			GetData: () => ({
				AIsource: AIsource?.filename || '',
				chardata, // STv2 格式
			}),
			/**
			 * 设置数据
			 * @param {{ chardata: chardata_t; AIsource: string; }} data 数据
			 */
			SetData: async data => {
				if (data.chardata) {
					chardata = data.chardata
					charAPI_definition.info = buildCharInfo(chardata)
					saveJsonFile(charjson, chardata) // 保存 STv2 格式
				}
				if (data.AIsource) AIsource = await loadAIsource(username, data.AIsource)
				else AIsource = await loadDefaultAIsource(username)
			}
		},
		chat: {
			/**
			 * 获取问候语
			 * @param {any} args 参数
			 * @param {any} index 索引
			 * @returns {{ content: any; content_for_show: any; }} 包含问候语内容的对象
			 */
			GetGreeting: (args, index) => {
				// CCv3 的 first_mes 和 alternate_greetings 不是多语言结构，直接使用 chardata 中的版本
				const greetings = [
					chardata?.first_mes,
					...chardata?.alternate_greetings || []
				].filter(g => g.trim())

				if (!greetings.length) greetings.push(`Hello, I am ${chardata.name}.`) // 默认问候
				if (index < 0 || index >= greetings.length) index = 0 // 安全索引

				const selectedGreeting = greetings[index]
				const env = getMacroEnv(args.UserCharname) // args.UserCharname 来自 fount 调用 GetGreeting 时的参数
				const result = evaluateMacros(selectedGreeting, env, args.chat_scoped_char_memory, args.chat_log)

				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: formatRisuOutput(runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly))
				}
			},
			/**
			 * 获取群组问候语
			 * @param {any} args 参数
			 * @param {any} index 索引
			 * @returns {{ content: any; content_for_show: any; }} 包含群组问候语内容的对象
			 */
			GetGroupGreeting: (args, index) => {
				// CCv3 的 group_only_greetings 被放到了 chardata.extensions.group_greetings
				// 这同样不是一个多语言结构
				const groupGreetings = (chardata.extensions?.group_greetings || []).filter(g => g.trim())

				if (!groupGreetings.length)  // 如果没有专门的群组问候，可以使用常规问候
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
			/**
			 * 获取提示
			 * @param {any} promptArgs 提示参数
			 * @returns {import("../../../../../src/public/ImportHandlers/SillyTavern/engine/prompt_builder").import('../../../../decl/prompt_struct.ts').single_part_prompt_t} 提示对象
			 */
			GetPrompt: (promptArgs /* fount prompt_struct_args_t */) => {
				// 确保传递给 promptBuilder 的 Charname 是我们期望的（考虑 nickname）
				const effectiveCharName = chardata.extensions?.ccv3_nickname || chardata.name
				const builderArgs = {
					...promptArgs,
					Charname: effectiveCharName, // 覆盖传入的 Charname
				}
				return promptBuilder(builderArgs, chardata, AIsource?.filename || 'default_model')
			},
			/**
			 * 获取回复
			 * @param {any} args 参数
			 * @returns {Promise<{ content: any; content_for_show: any; files: any; extension: any; }>} 包含回复内容的对象
			 */
			GetReply: async args => {
				if (!AIsource)
					return {
						// 此处的提示可以考虑根据 args.locales 进行 i18n，但属于模板细节优化
						content: 'This character does not have an AI source. Please [set the AI source](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage) first.'
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

				/**
				 * 添加长时间日志
				 * @param {any} entry 条目
				 */
				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id] // char_id 来自 fount 的参数
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}

				regen_loop: while (true) {
					const requestResult = await AIsource.StructCall(prompt_struct)
					result.content = requestResult.content
					result.files = (result.files || []).concat(requestResult.files || [])
					result.extension = { ...result.extension, ...requestResult.extension }

					// 插件处理逻辑 (如果你的fount系统有插件)
					const plugins = args.plugins || {} // 从 fount 运行时获取
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
			/**
			 * 获取回复频率
			 * @param {any} args 参数
			 * @returns {Promise<number>} 回复频率
			 */
			GetReplyFrequency: async args => {
				if (Object(chardata.extensions?.talkativeness) instanceof Number)
					return Math.max(0.1, Number(chardata.extensions.talkativeness) * 2) // ST 逻辑

				return 1 // 默认频率
			},
			/**
			 * 消息编辑
			 * @param {any} args 参数
			 * @returns {{ content: any; content_for_show: any; }} 编辑后的消息对象
			 */
			MessageEdit: args => {
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

/**
 *
 */
export default charAPI_definition // 导出定义好的对象
