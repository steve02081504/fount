import { regex_placement, world_info_position } from './charData.mjs'
import { evaluateMacros } from './marco.mjs'
import { parseRegexFromString } from './tools.mjs'
import { GetActivedWorldInfoEntries } from './world_info.mjs'

const DEFAULT_DEPTH = 0

/**
 *
 * @param {import('../../../../decl/prompt_struct.ts').prompt_struct_t} arg
 * @param {v2CharData} charData
 * @param {string} modelName
 * @returns {import('../../../../decl/prompt_struct.ts').single_part_prompt_t}
 */
export function promptBuilder(
	arg,
	charData,
	modelName
) {
	const username = arg.UserCharname
	const charname = arg.Charname
	const chatLog = arg.chat_log.map(entry => ({ // 保留 time_stamp
		role: entry.role,
		charname: entry.role === 'char' ? charname : entry.role === 'user' ? username : undefined,
		content: entry.content,
		time_stamp: entry.time_stamp // 保留 time_stamp
	}))
	const env = {
		char: charname,
		user: username,
		model: modelName,
		charVersion: charData.character_version,
		char_version: charData.character_version,
	}

	const aret = {
		system_prompt: charData.system_prompt,
		personality: charData.personality,
		user_description: username,
		scenario: charData.scenario,
		WIs_before_char: [],
		char_description: charData.description,
		WIs_after_char: [],
		mes_examples: [],
		chat_log: chatLog
	}
	for (const key in aret) if (Object(aret[key]) instanceof String) aret[key] = evaluateMacros(aret[key], env, arg.chat_scoped_char_memory, chatLog) // 传递 chatLog
	let WIs = charData?.character_book?.entries ?
		GetActivedWorldInfoEntries(charData.character_book.entries, chatLog, env, arg.chat_scoped_char_memory) :
		[]
	if (charData?.extensions?.regex_scripts) {
		const WI_regex_scripts = charData.extensions.regex_scripts.filter(e => e.placement.includes(regex_placement.WORLD_INFO))
		for (const script of WI_regex_scripts) script.findRegex = parseRegexFromString(String(script.findRegex))
		for (const e of WIs)
			for (const script of WI_regex_scripts)
				e.content = e.content.replace(script.findRegex, script.replaceString)
		WIs = WIs.filter(e => e.content)
	}
	let mes_examples = charData.mes_example.split(/\n<start>/gi).map(e => e.trim()).filter(e => e)
	let before_EMEntries = []
	let after_EMEntries = []
	let ANTopEntries = []
	let ANBottomEntries = []
	const WIDepthEntries = []
	function add_WI(
		/** @type {WorldInfoEntry} */
		entry
	) {
		const { content } = entry
		switch (entry.extensions.position) {
			case world_info_position.atDepth: {
				const existingDepthIndex = WIDepthEntries.findIndex((e) => e.depth === (entry.depth ?? DEFAULT_DEPTH) && e.role === entry.extensions.role)
				if (existingDepthIndex !== -1)
					WIDepthEntries[existingDepthIndex].entries.unshift(content)
				else
					WIDepthEntries.push({
						depth: entry.extensions?.depth || 0,
						entries: [content],
						role: entry.extensions.role,
					})

				break
			}
			default:
				[
					aret.WIs_before_char,
					aret.WIs_after_char,
					ANTopEntries,
					ANBottomEntries,
					null,
					before_EMEntries,
					after_EMEntries
				][entry.extensions.position || 0].unshift(entry)
				break
		}
	}
	const constant_WIs = WIs.filter(e => e.constant)
	WIs = WIs.filter(e => !e.constant).sort((a, b) => a.extensions.position - b.extensions.position || a.insertion_order - b.insertion_order)
	for (const WI of constant_WIs) add_WI(WI)
	for (const WI of WIs) add_WI(WI) // 简化 WI 添加，直接添加所有 WI，不再考虑 token 预算

	before_EMEntries = before_EMEntries.map(e => e.content)
	after_EMEntries = after_EMEntries.map(e => e.content)
	ANTopEntries = ANTopEntries.map(e => e.content)
	ANBottomEntries = ANBottomEntries.map(e => e.content)
	aret.WIs_before_char = aret.WIs_before_char.sort((a, b) => a.insertion_order - b.insertion_order).map(e => e.content)
	aret.WIs_after_char = aret.WIs_after_char.sort((a, b) => a.insertion_order - b.insertion_order).map(e => e.content)

	let aothr_notes = charData?.extensions?.depth_prompt?.prompt
	if (aothr_notes)
		aothr_notes = `${ANTopEntries.join('\n')}\n${aothr_notes}\n${ANBottomEntries.join('\n')}`.replace(/(^\n)|(\n$)/g, '')

	const additional_chat_log = []
	for (let index = 0; index < chatLog.length; index++) {
		const WIDepth = WIDepthEntries.filter((e) => e.depth === index)
		for (const entrie of WIDepth) {
			const role = ['system', 'user', 'assistant'][entrie.role]
			additional_chat_log.push({
				role,
				content: entrie.entries.join('\n'),
			})
		}
		if (charData?.extensions?.depth_prompt?.prompt && index == charData?.extensions?.depth_prompt?.depth)
			additional_chat_log.push({
				role: charData?.extensions?.depth_prompt?.role,
				content: aothr_notes
			})
	}

	mes_examples = [...before_EMEntries, ...mes_examples, ...after_EMEntries].filter(e => e)
	aret.mes_examples = mes_examples

	/** @type {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} */
	const char_prompt_result = {
		text: [],
		additional_chat_log: additional_chat_log.map(e => ({
			role: e.role === 'assistant' ? 'char' : e.role,
			content: e.content
		})),
		extension: {}
	}

	if (aret.mes_examples.length > 0)
		char_prompt_result.text.push({
			content: '示例对话：' + aret.mes_examples.join('\n\n'),
			description: 'mes_examples',
			important: -1
		})

	if (aret.system_prompt)
		char_prompt_result.text.push({
			content: aret.system_prompt,
			description: 'system_prompt',
			important: 3
		})

	if (aret.scenario)
		char_prompt_result.text.push({
			content: '场景：' + aret.scenario,
			description: 'scenario',
			important: 1
		})

	if (aret.WIs_before_char.length > 0)
		char_prompt_result.text.push({
			content: aret.WIs_before_char.join('\n'),
			description: 'WIs_before_char',
			important: 1
		})

	if (aret.personality)
		char_prompt_result.text.push({
			content: '人物个性：' + aret.personality,
			description: 'personality',
			important: 2
		})

	if (aret.char_description)
		char_prompt_result.text.push({
			content: '人物简介：' + aret.char_description,
			description: 'char_description',
			important: 2
		})

	if (aret.WIs_after_char.length > 0)
		char_prompt_result.text.push({
			content: aret.WIs_after_char.join('\n'),
			description: 'WIs_after_char',
			important: 3
		})

	return char_prompt_result
}
