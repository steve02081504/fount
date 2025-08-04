import seedrandom from 'npm:seedrandom'

import { world_info_logic, world_info_position, extension_prompt_roles } from './charData.mjs' // 假设 charData.mjs 定义了这些枚举和类型
import { evaluateMacros } from './marco.mjs' // 假设宏引擎已修改并接受 chat_scoped_char_memory
import { escapeRegExp, parseRegexFromString } from './tools.mjs' // 假设 tools.mjs 包含这些工具函数

export const WISettings = { // WI 设置，可以保持默认值或根据 fount 环境调整
	depth: 4, // 扫描深度，表示在多少轮对话中查找关键词
	isSensitive: false, // 是否区分大小写
	isFullWordMatch: true // 是否全词匹配
}

/**
 * 构建关键词列表，将字符串关键词转换为正则表达式
 * @param {string[]} keys 关键词数组
 * @param {boolean} isSensitive 是否区分大小写
 * @param {boolean} isFullWordMatch 是否全词匹配
 * @returns {RegExp[]} 正则表达式数组
 */
function buildKeyList(keys, isSensitive, isFullWordMatch) {
	return keys.map(key => {
		const regtest = parseRegexFromString(key) // 尝试解析为正则表达式
		if (regtest) return regtest // 如果解析成功，直接返回正则表达式
		key = escapeRegExp(key) // 转义正则表达式特殊字符
		if (isFullWordMatch) key = `\\b${key}\\b` // 如果是全词匹配，添加单词边界
		return new RegExp(key, isSensitive ? 'ug' : 'ugi') // 创建正则表达式
	})
}

/**
 * 判断是否至少有一个正则表达式匹配内容
 * @param {RegExp[]} list 正则表达式数组
 * @param {string} content 要匹配的内容
 * @returns {boolean} 是否匹配
 */
function isAnyMatch(/** @type {RegExp[]} */list, /** @type {string} */content) {
	for (const key of list)
		if (key.test(content)) return true // 如果任何一个正则表达式匹配，则返回 true
	return false
}

/**
 * 判断是否所有正则表达式都匹配内容
 * @param {RegExp[]} list 正则表达式数组
 * @param {string} content 要匹配的内容
 * @returns {boolean} 是否匹配
 */
function isAllMatch(/** @type {RegExp[]} */list, /** @type {string} */content) {
	for (const key of list)
		if (!key.test(content)) return false // 如果任何一个正则表达式不匹配，则返回 false
	return true
}

/**
 * 判断是否没有任何正则表达式匹配内容
 * @param {RegExp[]} list 正则表达式数组
 * @param {string} content 要匹配的内容
 * @returns {boolean} 是否匹配
 */
function notAnyMatch(/** @type {RegExp[]} */list, /** @type {string} */content) {
	for (const key of list)
		if (key.test(content)) return false // 如果任何一个正则表达式匹配，则返回 false
	return true
}

/**
 * 判断是否不是所有正则表达式都匹配内容
 * @param {RegExp[]} list 正则表达式数组
 * @param {string} content 要匹配的内容
 * @returns {boolean} 是否匹配
 */
function notAllMatch(/** @type {RegExp[]} */list, /** @type {string} */content) {
	for (const key of list)
		if (!key.test(content)) return true // 如果任何一个正则表达式不匹配，则返回 true
	return false
}

/**
 * 预处理 WI 条目：编译正则表达式，并准备激活检查
 * @param {WorldInfoEntry[]} WIentries WI 条目数组
 */
function preBuiltWIEntries(WIentries) {
	for (const entrie of WIentries) {
		const isSensitive = entrie.extensions.case_sensitive === undefined ? WISettings.isSensitive : entrie.extensions.case_sensitive // 获取是否区分大小写
		const isFullWordMatch = entrie.extensions.match_whole_words === undefined ? WISettings.isFullWordMatch : entrie.extensions.match_whole_words // 获取是否全词匹配
		entrie.keys = buildKeyList(entrie.keys, isSensitive, isFullWordMatch) // 构建关键词正则表达式列表
		entrie.secondary_keys = buildKeyList(entrie.secondary_keys, isSensitive, isFullWordMatch) // 构建辅助关键词正则表达式列表

		entrie.isActived = (chatLog, recursion_WIs, memory, entryIndex) => { // 传递 memory 和 entryIndex
			const last_enabled_chat_length = memory?.enabled_WI_entries?.[entryIndex] ?? 0 // 使用 entryIndex 访问激活状态

			if (entrie.extensions.delay && entrie.extensions.delay > chatLog.length) return false // 如果有延迟，并且延迟大于对话长度，则不激活
			if (entrie.extensions.sticky && last_enabled_chat_length + entrie.extensions.sticky >= chatLog.length) return true // 如果是粘性的，并且上次激活时间加上粘性持续时间大于当前对话长度，则激活
			if (entrie.extensions.cooldown && last_enabled_chat_length + entrie.extensions.cooldown <= chatLog.length) return false // 如果有冷却时间，并且上次激活时间加上冷却时间小于等于当前对话长度，则不激活
			if (entrie.extensions.useProbability && seedrandom(
				entrie.keys.join() + entrie.secondary_keys.join() + entrie.content, { entropy: true }
			)() > entrie.extensions.probability / 100) return false // 如果有概率，并且随机数大于概率，则不激活

			let content = chatLog.slice(-WISettings.depth).map(e => (e.charname || e.role) + ': ' + e.content).join('\n') // 获取最近对话记录，并拼接成字符串
			if (!entrie.extensions.exclude_recursion) content += '\n' + recursion_WIs.join('\n'); // 如果不排除递归，则添加递归 WI 内容

			[...entrie.keys, ...entrie.secondary_keys].forEach(key => { key.lastIndex = 0 }) // 重置正则表达式 lastIndex
			if (isAnyMatch(entrie.keys, content)) { // 如果主关键词匹配
				if (entrie.secondary_keys.length === 0) return true // 如果没有辅助关键词，则激活
				switch (entrie.extensions.selectiveLogic) { // 根据选择逻辑判断是否激活
					case world_info_logic.AND_ALL: return isAllMatch(entrie.secondary_keys, content) // 所有辅助关键词都匹配
					case world_info_logic.AND_ANY: return isAnyMatch(entrie.secondary_keys, content) // 任何一个辅助关键词匹配
					case world_info_logic.NOT_ALL: return notAllMatch(entrie.secondary_keys, content) // 不是所有辅助关键词都匹配
					case world_info_logic.NOT_ANY: return notAnyMatch(entrie.secondary_keys, content) // 没有任何一个辅助关键词匹配
				}
			}
			return false // 如果主关键词不匹配或辅助关键词不满足条件，则不激活
		}
	}
}

/**
 * 获取激活的 WI 条目列表
 * @param {WorldInfoEntry[]} WIentries 所有 WI 条目
 * @param {{role:string,charname?:string,content:string}[]} chatLog 聊天记录
 * @param {Record<string, any>} env 环境信息（用户、角色、模型等）
 * @param {Record<string, any>} memory 聊天作用域的内存对象
 * @returns {WorldInfoEntry[]} 激活的 WI 条目数组
 */
export function GetActivedWorldInfoEntries(
	WIentries,
	chatLog,
	env,
	memory
) {
	/** @type {WorldInfoEntry[]} */
	let WIdata_copy = structuredClone(WIentries.filter(e => e.enabled)) // 使用 structuredClone 进行深拷贝
	let aret = [] // 存储激活的 WI 条目

	// 初始化内存中的 enabled_WI_entries，如果不存在的话
	memory.enabled_WI_entries ??= {}

	for (const entrie of WIdata_copy) {
		entrie.keys = entrie.keys.map(k => evaluateMacros(k, env, memory)).filter(k => k) // 替换关键词中的宏
		entrie.secondary_keys = entrie.secondary_keys.map(k => evaluateMacros(k, env, memory)).filter(k => k) // 替换辅助关键词中的宏
		entrie.extensions ??= {} // 确保 extensions 存在
		entrie.extensions.position ??= entrie.position == 'before_char' ? world_info_position.before : world_info_position.after // 设置位置
		entrie.extensions.role ??= extension_prompt_roles.SYSTEM // 设置角色
	}

	preBuiltWIEntries(WIdata_copy) // 预处理 WI 条目
	let recursion_WIs = [] // 存储递归 WI 内容
	const availableRecursionDelayLevels = [...new Set(
		WIdata_copy.map(entry => Number(entry.extensions.delay_until_recursion))
	)].sort((a, b) => a - b) // 获取并排序所有延迟递归级别

	for (const currentRecursionDelayLevel of availableRecursionDelayLevels) {
		let new_entries = []
		do {
			let WIdata_new = [...WIdata_copy]
			new_entries = []
			for (let i = 0; i < WIdata_copy.length; i++) { // 使用索引循环
				const entrie = WIdata_copy[i]
				if (entrie.constant || entrie.isActived(chatLog, recursion_WIs, memory, i)) { // 传递索引 i
					if (entrie.extensions.delay_until_recursion > currentRecursionDelayLevel) continue

					memory.enabled_WI_entries[i] = chatLog.length // 存储激活回合数，使用索引 i

					entrie.content = evaluateMacros(entrie.content, env, memory) // 替换 WI 内容中的宏
					new_entries.push(entrie) // 添加到新激活的 WI 条目
					WIdata_new = WIdata_new.filter(e => e !== entrie) // 从待处理 WI 列表中移除
				}
			}
			WIdata_copy = WIdata_new.filter(e => !e.extensions.exclude_recursion) // 移除排除递归的 WI 条目
			recursion_WIs = recursion_WIs.concat(new_entries.filter(e => !e.extensions.prevent_recursion).map(e => e.content)) // 添加到递归 WI 列表中
			aret = aret.concat(new_entries) // 合并到结果列表中
		} while (new_entries.length) // 如果有新的激活条目，则继续
	}

	for (const entrie of aret) delete entrie.isActived // 清理 isActived 函数
	return aret // 返回激活的 WI 条目列表
}
