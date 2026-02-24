import seedrandom from 'npm:seedrandom'

import { world_info_logic, world_info_position, extension_prompt_roles } from './charData.mjs' // 假设 charData.mjs 定义了这些枚举和类型
import { evaluateMacros } from './marco.mjs' // 假设宏引擎已修改并接受 chat_scoped_char_memory
import { escapeRegExp, parseRegexFromString } from './tools.mjs' // 假设 tools.mjs 包含这些工具函数

/**
 * WI 设置
 */
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
	for (const entry of WIentries) {
		const isSensitive = entry.extensions.case_sensitive === undefined ? WISettings.isSensitive : entry.extensions.case_sensitive // 获取是否区分大小写
		const isFullWordMatch = entry.extensions.match_whole_words === undefined ? WISettings.isFullWordMatch : entry.extensions.match_whole_words // 获取是否全词匹配
		entry.keys = buildKeyList(entry.keys, isSensitive, isFullWordMatch) // 构建关键词正则表达式列表
		entry.secondary_keys = buildKeyList(entry.secondary_keys, isSensitive, isFullWordMatch) // 构建辅助关键词正则表达式列表

		/**
		 * @param {any} chatLog 聊天记录
		 * @param {any} recursion_WIs 递归世界信息
		 * @param {any} memory 内存
		 * @param {number} entryKey 条目稳定键（用于 enabled_WI_entries）
		 * @returns {boolean} 如果条目已激活，则返回 true。
		 */
		entry.isActivated = (chatLog, recursion_WIs, memory, entryKey) => { // 使用稳定 entryKey 访问激活状态，避免过滤后下标错位
			const last_enabled_chat_length = memory?.enabled_WI_entries?.[entryKey] // 未激活过为 undefined，不默认 0 以免 sticky 误判为“已激活”

			if (entry.extensions.delay && entry.extensions.delay > chatLog.length) return false // 如果有延迟，并且延迟大于对话长度，则不激活
			if (entry.extensions.sticky && last_enabled_chat_length != null && last_enabled_chat_length + entry.extensions.sticky >= chatLog.length) return true // 仅当此前真正激活过时，才在粘性期内保持激活
			if (entry.extensions.cooldown && last_enabled_chat_length != null && chatLog.length < last_enabled_chat_length + entry.extensions.cooldown) return false // 冷却期内不再次激活
			if (entry.extensions.useProbability && seedrandom(
				entry.keys.join() + entry.secondary_keys.join() + entry.content, { entropy: true }
			)() > entry.extensions.probability / 100) return false // 如果有概率，并且随机数大于概率，则不激活

			let content = chatLog.slice(-WISettings.depth).map(e => (e.charname || e.role) + ': ' + e.content).join('\n') // 获取最近对话记录，并拼接成字符串
			if (!entry.extensions.exclude_recursion) content += '\n' + recursion_WIs.join('\n'); // 如果不排除递归，则添加递归 WI 内容

			[...entry.keys, ...entry.secondary_keys].forEach(key => { key.lastIndex = 0 }) // 重置正则表达式 lastIndex
			if (isAnyMatch(entry.keys, content)) { // 如果主关键词匹配
				if (!entry.secondary_keys.length) return true // 如果没有辅助关键词，则激活
				switch (entry.extensions.selectiveLogic) { // 根据选择逻辑判断是否激活
					case world_info_logic.AND_ALL: return isAllMatch(entry.secondary_keys, content) // 所有辅助关键词都匹配
					case world_info_logic.AND_ANY: return isAnyMatch(entry.secondary_keys, content) // 任何一个辅助关键词匹配
					case world_info_logic.NOT_ALL: return notAllMatch(entry.secondary_keys, content) // 不是所有辅助关键词都匹配
					case world_info_logic.NOT_ANY: return notAnyMatch(entry.secondary_keys, content) // 没有任何一个辅助关键词匹配
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
export function GetActivatedWorldInfoEntries(
	WIentries,
	chatLog,
	env,
	memory
) {
	/** @type {WorldInfoEntry[]} */
	let WIdata_copy = structuredClone(WIentries.filter(e => e.enabled)) // 使用 structuredClone 进行深拷贝
	let aret = [] // 存储激活的 WI 条目

	// 为每条目分配稳定 key，避免 do-while 内过滤导致下标变化、enabled_WI_entries 错位（条件世界书激活一次就永久激活）
	WIdata_copy.forEach((e, i) => { e.enable_index = i })

	// 初始化内存中的 enabled_WI_entries，如果不存在的话
	memory.enabled_WI_entries ??= {}

	for (const entry of WIdata_copy) {
		entry.keys = entry.keys.map(k => evaluateMacros(k, env, memory)).filter(k => k) // 替换关键词中的宏
		entry.secondary_keys = entry.secondary_keys.map(k => evaluateMacros(k, env, memory)).filter(k => k) // 替换辅助关键词中的宏
		entry.extensions ??= {} // 确保 extensions 存在
		entry.extensions.position ??= entry.position == 'before_char' ? world_info_position.before : world_info_position.after // 设置位置
		entry.extensions.role ??= extension_prompt_roles.SYSTEM // 设置角色
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
			for (let i = 0; i < WIdata_copy.length; i++) {
				const entry = WIdata_copy[i]
				if (entry.constant || entry.isActivated(chatLog, recursion_WIs, memory, entry.enable_index)) {
					if (entry.extensions.delay_until_recursion > currentRecursionDelayLevel) continue

					memory.enabled_WI_entries[entry.enable_index] = chatLog.length // 用稳定 key 存储，避免过滤后下标错位

					entry.content = evaluateMacros(entry.content, env, memory) // 替换 WI 内容中的宏
					new_entries.push(entry) // 添加到新激活的 WI 条目
					WIdata_new = WIdata_new.filter(e => e !== entry) // 从待处理 WI 列表中移除
				}
			}
			WIdata_copy = WIdata_new.filter(e => !e.extensions.exclude_recursion) // 移除排除递归的 WI 条目
			recursion_WIs = recursion_WIs.concat(new_entries.filter(e => !e.extensions.prevent_recursion).map(e => e.content)) // 添加到递归 WI 列表中
			aret = aret.concat(new_entries) // 合并到结果列表中
		} while (new_entries.length) // 如果有新的激活条目，则继续
	}

	for (const entry of aret) {
		delete entry.isActivated
		delete entry.enable_index
	}
	return aret // 返回激活的 WI 条目列表
}
