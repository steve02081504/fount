import {
	world_info_logic,
	world_info_position,
	extension_prompt_roles,
	// v2CharData, // ST 的 v2CharData 定义，我们在这里构建它
	// WorldInfoEntry, // ST 的 WorldInfoEntry 定义
} from '../SillyTavern/engine/charData.mjs' // 确保路径正确

/**
 * 将 Risu CCv3 卡片数据 (及可选的 module 数据) 转换为 SillyTavern v2CharData 格式
 * @param {object} ccv3Card - 解析后的 CCv3 card.json 对象
 * @param {object} [risuModule] - 可选的，解析后的 Risu Module 定义对象
 * @param {string} [userLanguage='en'] - 用于选择多语言字段的用户偏好语言
 * @returns {object} SillyTavern v2CharData 对象
 */
export function convertCCv3ToSTv2(ccv3Card, risuModule, userLanguage = 'en') {
	const cardData = ccv3Card.data
	const stV2Data = {
		name: cardData.name || 'Unnamed Character',
		description: cardData.description || '',
		personality: cardData.personality || '',
		scenario: cardData.scenario || '',
		first_mes: cardData.first_mes || '',
		mes_example: cardData.mes_example || '',
		creator_notes: '', // 将从 ccv3 creator_notes 或 multilingual 中选取
		tags: cardData.tags || [],
		system_prompt: cardData.system_prompt || '',
		post_history_instructions: cardData.post_history_instructions || '', // ST v2 中此字段用途可能与 CCv3 不同
		creator: cardData.creator || '',
		character_version: cardData.character_version || '1.0',
		alternate_greetings: cardData.alternate_greetings || [],
		// SillyTavern v2 特有的 extensions 结构
		extensions: {
			talkativeness: 0.5, // ST 默认值
			fav: false,
			// world: '', // ST world 字段，CCv3 Lorebook 更复杂
			// depth_prompt: {}, // ST depth_prompt
			// regex_scripts: [], // ST regex_scripts
			// --- Risu 特有或需要映射的 ---
			source_url: cardData.source && cardData.source.length > 0 ? cardData.source[0] : '',
			// 用于存放处理过的 risu assets 列表，供模板高级使用
			risu_assets: cardData.assets ? JSON.parse(JSON.stringify(cardData.assets)) : [],
			// CCv3 group_only_greetings
			group_greetings: cardData.group_only_greetings || [],
			// CCv3 nickname for ST {{char}} macro
			// ST 的 prompt_builder 使用 args.Charname, 我们在 main.mjs 中处理
			// 这里可以存一个原始的 nickname 供参考或模板使用
			ccv3_nickname: cardData.nickname || '',
		},
		character_book: { // ST 的 character_book 结构
			name: cardData.character_book?.name || risuModule?.name || 'Imported Lorebook',
			description: cardData.character_book?.description || risuModule?.description || '',
			scan_depth: cardData.character_book?.scan_depth, // ST WI 单条目有 scan_depth
			token_budget: cardData.character_book?.token_budget, // ST 无全局token budget for WI
			recursive_scanning: cardData.character_book?.recursive_scanning, // ST WI 单条目有 exclude_recursion
			extensions: {}, // ST character_book.extensions
			entries: [], // 将填充转换后的 LorebookEntry
		},
	}

	// 处理 creator_notes (多语言)
	if (cardData.creator_notes_multilingual && cardData.creator_notes_multilingual[userLanguage])
		stV2Data.creator_notes = cardData.creator_notes_multilingual[userLanguage]
	else if (cardData.creator_notes_multilingual && cardData.creator_notes_multilingual['en'])
		stV2Data.creator_notes = cardData.creator_notes_multilingual['en']
	else
		stV2Data.creator_notes = cardData.creator_notes || ''


	// 合并 Lorebook 条目 (来自 card.character_book 和 risuModule.lorebook)
	let allLoreEntries = []
	if (cardData.character_book && Array.isArray(cardData.character_book.entries))
		allLoreEntries = allLoreEntries.concat(cardData.character_book.entries)

	if (risuModule && Array.isArray(risuModule.lorebook)) { // Risu 模块的 lorebook 格式与卡片内嵌的不同
		// Risu 模块的 lorebook 是 ST-like 的格式，需要适配转换
		// Risu Module LorebookEntry: {key, secondkey, insertorder, comment, content, mode, alwaysActive, selective, extentions, useRegex}
		// CCv3 Card LorebookEntry: {keys, content, extensions, enabled, insertion_order, case_sensitive, use_regex, constant, name, priority, id, comment, selective, secondary_keys, position}
		// 这里我们假设 risuModule.lorebook 已经是 CCv3 LorebookEntry 格式，如果不是，需要额外转换层
		// 从 Risu 源码看，module.lorebook 确实是不同的格式，更接近旧版 ST 或 AgnAI。
		// 为了简化，这里假设 risuModule.lorebook 提供的条目也遵循 CCv3 Entry 结构或已预转换为此结构
		// 如果 risuModule.lorebook 的条目是 ST 的 WorldInfoEntry 格式，那转换目标就是它，反而简单了
		// 但规范中 module.lorebook 是 `loreBook[]` 类型，`loreBook` 有 `key`, `secondkey` 等。
		// 这里我们暂时假设，如果提供了 risuModule，其 lorebook 优先级更高或需要特殊处理。
		// 为了演示，我们先假设 module 的 lorebook 也是 ccv3 entry 格式
		console.warn('Risu module lorebook conversion might need specific adapter if its format differs significantly from CCv3 card lorebook entries.')
		allLoreEntries = allLoreEntries.concat(risuModule.lorebook || [])
	}

	for (const ccv3Entry of allLoreEntries) {
		if (!ccv3Entry.enabled) continue

		const stWiEntry = {
			id: ccv3Entry.id || Date.now() + Math.random(), // ST 需要 id
			keys: Array.isArray(ccv3Entry.keys) ? ccv3Entry.keys : ccv3Entry.key ? [ccv3Entry.key] : [], // CCv3 keys is array, module.key is string
			secondary_keys: [], // 将从 ccv3Entry.secondary_keys 或 decorators 处理
			comment: ccv3Entry.comment || ccv3Entry.name || '',
			content: ccv3Entry.content || '',
			constant: ccv3Entry.constant || false,
			selective: false, // 将基于 ccv3Entry.selective 和 secondary_keys 决定
			insertion_order: ccv3Entry.insertion_order || 0,
			enabled: ccv3Entry.enabled !== false, // 默认为 true
			position: ccv3Entry.position === 'after_char' ? 'after_char' : 'before_char', // ST v1 WI position
			extensions: { // ST v2 WI extensions
				position: ccv3Entry.position === 'after_char' ? world_info_position.after : world_info_position.before,
				exclude_recursion: false, // 默认不排除
				// display_index: 0, // ST UI 相关
				probability: 100,
				useProbability: false,
				depth: 4, // ST WI 默认扫描深度 (atDepth 类型)
				selectiveLogic: world_info_logic.AND_ANY, // 默认
				// group: '',
				// group_override: false,
				prevent_recursion: false, // CCv3 recursive_scanning 全局设置，这里是单条目
				scan_depth: ccv3Entry.extensions?.scan_depth ?? cardData.character_book?.scan_depth, // 条目优先，否则用书的
				match_whole_words: true, // ST WI 默认
				case_sensitive: ccv3Entry.case_sensitive === true, // CCv3 case_sensitive
				// automation_id: '',
				role: extension_prompt_roles.SYSTEM, // 默认
				// vectorized: false,
				sticky: 0,
				delay_until_recursion: 0,
				cooldown: 0,
				// -- Risu Specifics to map --
				use_regex_from_ccv3: ccv3Entry.use_regex || false, // 标记一下，ST WI key 直接支持 /regex/
			},
		}

		// 处理 ccv3Entry.selective 和 ccv3Entry.secondary_keys
		if (ccv3Entry.selective && ccv3Entry.secondary_keys && ccv3Entry.secondary_keys.length > 0) {
			stWiEntry.selective = true
			stWiEntry.secondary_keys = ccv3Entry.secondary_keys
			stWiEntry.extensions.selectiveLogic = world_info_logic.AND_ANY // CCv3 "SHOULD NOT considered as a match if the chat log do not contains one of the strings"
		}

		// 处理 CCv3 decorators (修改 stWiEntry.content 和 stWiEntry.extensions)
		const decorators = []
		const contentLines = stWiEntry.content.split('\n')
		const cleanContentLines = []
		for (const line of contentLines)
			if (line.startsWith('@@'))
				decorators.push(line)
			else
				cleanContentLines.push(line)


		stWiEntry.content = cleanContentLines.join('\n').trim()

		for (const decoratorLine of decorators) {
			const parts = decoratorLine.substring(2).trim().split(/\s+/)
			const name = parts[0]
			const value = parts.slice(1).join(' ')

			switch (name) {
				case 'activate_only_after':
					stWiEntry.extensions.delay_until_recursion = parseInt(value, 10) || 0
					break
				case 'keep_activate_after_match':
					stWiEntry.extensions.sticky = 9999 // 一个很大的数表示持久
					break
				case 'dont_activate_after_match':
					stWiEntry.extensions.cooldown = 1 // 激活一次后进入冷却
					// 可能还需要配合脚本在激活后禁用自身，ST WI没这功能
					break
				case 'depth':
					stWiEntry.extensions.position = world_info_position.atDepth
					stWiEntry.extensions.depth = parseInt(value, 10) || 0
					break
				case 'role':
					if (value === 'user') stWiEntry.extensions.role = extension_prompt_roles.USER
					else if (value === 'assistant') stWiEntry.extensions.role = extension_prompt_roles.ASSISTANT
					else stWiEntry.extensions.role = extension_prompt_roles.SYSTEM
					break
				case 'scan_depth':
					stWiEntry.extensions.scan_depth = parseInt(value, 10)
					break
				case 'position': // "after_desc", "before_desc", "personality", "scenario"
					// ST WI 没有这么细致的插入点。这些内容可以考虑在导入时预合并，或作为普通WI。
					// 为简单起见，我们将其映射到 before/after char。
					if (value === 'after_char' || value === 'after_desc' || value === 'personality' || value === 'scenario') { // 粗略映射
						stWiEntry.extensions.position = world_info_position.after
						stWiEntry.position = 'after_char'
					}
					else {
						stWiEntry.extensions.position = world_info_position.before
						stWiEntry.position = 'before_char'
					}
					break
				case 'additional_keys':
					// ST WI 的 keys 和 secondary_keys 都是数组。
					// 如果 use_regex 为 true，这些也应被视为正则。
					// CCv3: "decorator that modifies keys field's behavior also modifies additional_keys field"
					// 我们简单地将它们添加到主 keys 列表。
					stWiEntry.keys = stWiEntry.keys.concat(value.split(',').map(k => k.trim()))
					break
				case 'exclude_keys':
					// ST 没有直接的排除键。可以用 selectiveLogic 模拟。
					// 如果已有 secondary_keys，这个逻辑会复杂。
					// 简单处理：如果主key匹配，且这个exclude_key也匹配，则WI不激活。
					// 这需要 ST WI 引擎支持更复杂的逻辑，或在 content 中用宏判断。
					// 暂时忽略，或转为 NOT_ANY (如果这是唯一的secondary_keys来源)
					if (!stWiEntry.selective) { // 如果还没有用上 secondary_keys
						stWiEntry.selective = true
						stWiEntry.secondary_keys = value.split(',').map(k => k.trim())
						stWiEntry.extensions.selectiveLogic = world_info_logic.NOT_ANY
					}
					else console.warn(`WI entry already has selective keys, cannot easily apply @@exclude_keys: ${value}`)

					break
				// 其他 decorators 如 activate_only_every, instruct_depth 等，映射复杂或ST无直接对应，暂时忽略
				default:
					// console.log(`Unsupported decorator: ${name}`);
					break
			}
		}
		stV2Data.character_book.entries.push(stWiEntry)
	}

	// 处理 Regex Scripts (来自 Risu Module)
	stV2Data.extensions.regex_scripts = []
	if (risuModule && Array.isArray(risuModule.regex))
		// Risu module `customscript` 结构: {scriptName, findRegex, replaceString, trimStrings, placement[], disabled, markdownOnly, promptOnly, runOnEdit, substituteRegex, minDepth, maxDepth}
		// ST `regex_script_info` 结构基本一致
		for (const script of risuModule.regex)
			stV2Data.extensions.regex_scripts.push({ ...script })



	// 处理 Triggers (来自 Risu Module)
	// ST 没有直接的 trigger script 系统。这些是高级脚本，难以直接转换。
	// 可以考虑将它们的逻辑（如果简单）用 ST 宏在特定 WI 的 content 中实现，或者忽略。
	if (risuModule && Array.isArray(risuModule.trigger) && risuModule.trigger.length > 0) {
		console.warn('Risu module \'trigger\' scripts are not directly supported and will be ignored.')
		// 你可以在 stV2Data.extensions 中存一份原始 trigger 脚本供开发者参考
		stV2Data.extensions.ccv3_triggers = risuModule.trigger
	}

	return stV2Data
}
