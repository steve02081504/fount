/**
 * Change-Prompt 源的 prompt 变换与 BuildPrompt 委托（纯，无服务端依赖）。
 */
import { formatStr } from '../../../../../scripts/format.mjs'
import { delegateBuildPrompt } from '../proxy/src/buildPromptDelegation.mjs'

/**
 * 获取单一部分的提示对象。
 * @returns {{text: any[], additional_chat_log: any[], extension: {}}} 单一部分的提示对象。
 */
export function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

/**
 * 按配置把 prompt_struct 变换成注入自定义内容后的新 prompt_struct，对应 StructCall 的变换逻辑。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 原始结构化提示。
 * @param {object} config - 配置对象。
 * @returns {Promise<object>} 变换后的 prompt_struct。
 */
export async function buildChangedPromptStruct(prompt_struct, config) {
	const new_prompt_struct = {
		char_id: prompt_struct.char_id,
		UserCharname: prompt_struct.UserCharname,
		ReplyToCharname: prompt_struct.ReplyToCharname,
		UserUid: prompt_struct.UserUid,
		CharUid: prompt_struct.CharUid,
		ReplyToUid: prompt_struct.ReplyToUid,
		Charname: prompt_struct.Charname,
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompts: {},
		other_personas_prompts: {},
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: {},
		chat_log: prompt_struct.chat_log,
	}
	let eval_strings = {
		char_prompt: '',
		user_prompt: '',
		world_prompt: '',
		other_chars_prompts: '',
		other_personas_prompts: '',
		plugin_prompts: '',
	}
	if (config.build_prompt) {
		{
			const sorted = prompt_struct.char_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
			eval_strings.char_prompt = sorted.join('\n')
		}

		{
			const sorted = prompt_struct.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
			eval_strings.user_prompt = sorted.join('\n')
		}

		{
			const sorted = prompt_struct.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
			eval_strings.world_prompt = sorted.join('\n')
		}

		{
			const sorted = Object.values(prompt_struct.other_chars_prompts).map(char => char.text).filter(Boolean).map(
				char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
			).flat().filter(Boolean)
			eval_strings.other_chars_prompts = sorted.join('\n')
		}

		{
			const sorted = Object.values(prompt_struct.other_personas_prompts || {}).map(persona => persona.text).filter(Boolean).map(
				persona => persona.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
			).flat().filter(Boolean)
			eval_strings.other_personas_prompts = sorted.join('\n')
		}

		{
			const sorted = Object.values(prompt_struct.plugin_prompts).map(plugin => plugin?.text).filter(Boolean).map(
				plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
			).flat().filter(Boolean)
			eval_strings.plugin_prompts = sorted.join('\n')
		}
	}
	else {
		new_prompt_struct.char_prompt = prompt_struct.char_prompt
		new_prompt_struct.user_prompt = prompt_struct.user_prompt
		new_prompt_struct.world_prompt = prompt_struct.world_prompt
		new_prompt_struct.other_chars_prompts = prompt_struct.other_chars_prompts
		new_prompt_struct.other_personas_prompts = prompt_struct.other_personas_prompts || {}
		new_prompt_struct.plugin_prompts = prompt_struct.plugin_prompts
		eval_strings = {}
	}
	for (const change of config.changes) {
		const value = {
			name: 'system',
			role: 'system',
			files: [],
			extension: {},
			...change.content,
			content: await formatStr(change.content.content, {
				...eval_strings,
				...prompt_struct,
			})
		}
		const { chat_log } = new_prompt_struct
		if (change.insert_depth > 0)
			// 正数表示在后插入
			if (chat_log.length > change.insert_depth)
				chat_log.splice(chat_log.length - change.insert_depth, 0, value)
			else
				chat_log.unshift(value)
		else
			// 负数表示在前插入
			if (chat_log.length > -change.insert_depth)
				chat_log.splice(-change.insert_depth, 0, value)
			else
				chat_log.push(value)
	}
	return new_prompt_struct
}

/**
 * 应用与 StructCall 相同的 prompt 变换后，委托基础源构建 prompt 结构。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 配置对象。
 * @param {object} base_source - 基础内层 AI 源。
 * @returns {Promise<object|unknown[]>} 构建结果。
 */
export async function buildPromptChanged(prompt_struct, config, base_source) {
	const new_prompt_struct = await buildChangedPromptStruct(prompt_struct, config)
	return delegateBuildPrompt(base_source, new_prompt_struct)
}
