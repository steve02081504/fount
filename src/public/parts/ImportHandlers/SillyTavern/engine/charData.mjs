/**
 * SillyTavern 角色卡与世界信息数据结构定义。
 * 提供 V1/V2 角色卡类型、世界信息条目及相关转换函数。
 */
/**
 * 世界信息逻辑枚举。
 * @enum {number}
 */
export const world_info_logic = {
	AND_ANY: 0,
	NOT_ALL: 1,
	NOT_ANY: 2,
	AND_ALL: 3,
}
/**
 * 世界信息插入位置枚举。
 * @enum {number}
 */
export const world_info_position = {
	before: 0,
	after: 1,
	ANTop: 2,
	ANBottom: 3,
	atDepth: 4,
	EMTop: 5,
	EMBottom: 6,
}
/**
 * 正则表达式脚本放置位置。
 * @enum {number}
 */
export const regex_placement = {
	/**
	 * 显示文本。
	 * @deprecated MD Display 已弃用，请勿使用。
	 */
	MD_DISPLAY: 0,
	USER_INPUT: 1,
	AI_OUTPUT: 2,
	SLASH_COMMAND: 3,
	// 4 - sendAs (legacy)
	WORLD_INFO: 5,
}
/**
 * 世界信息锚点位置枚举。
 * @enum {number}
 */
export const wi_anchor_position = {
	before: 0,
	after: 1,
}
/**
 * 扩展提示词角色枚举。
 * @enum {number}
 */
export const extension_prompt_roles = {
	SYSTEM: 0,
	USER: 1,
	ASSISTANT: 2,
}
/** 世界信息条目。 */
export class WorldInfoEntry {
	/**
	 * 条目 ID。
	 * @type {number}
	 */
	id
	/**
	 * 触发关键词。
	 * @type {string[]}
	 */
	keys
	/**
	 * 次要触发关键词。
	 * @type {string[]}
	 */
	secondary_keys
	/**
	 * 条目备注。
	 * @type {string}
	 */
	comment
	/**
	 * 条目内容。
	 * @type {string}
	 */
	content
	/**
	 * 是否为常量条目。
	 * @type {boolean}
	 */
	constant
	/**
	 * 是否启用选择性匹配。
	 * @type {boolean}
	 */
	selective
	/**
	 * 插入顺序。
	 * @type {number}
	 * @default 100
	 */
	insertion_order
	/**
	 * 是否启用。
	 * @type {boolean}
	 * @default true
	 */
	enabled
	/**
	 * 插入位置。
	 * @type {"before_char" | "after_char" | string}
	 * @default "before_char"
	 */
	position
	/** 扩展数据。 */
	extensions = {
		/**
		 * 扩展字段中的插入位置。
		 * @type {number}
		 * @default 0
		 */
		position: 0,
		/**
		 * 是否排除递归。
		 * @type {boolean}
		 * @default false
		 */
		exclude_recursion: false,
		/**
		 * 显示索引。
		 * @type {number}
		 */
		display_index: 0,
		/**
		 * 触发概率。
		 * @type {number}
		 * @default 100
		 */
		probability: 100,
		/**
		 * 是否使用触发概率。
		 * @type {boolean}
		 * @default true
		 */
		useProbability: true,
		/**
		 * 扫描深度。
		 * @type {number}
		 * @default 4
		 */
		depth: 4,
		/**
		 * 选择性逻辑。
		 * @type {world_info_logic}
		 * @default 0
		 */
		selectiveLogic: 0,
		/**
		 * 所属分组。
		 * @type {string}
		 */
		group: '',
		/**
		 * 是否覆盖分组。
		 * @type {boolean}
		 * @default false
		 */
		group_override: false,
		/**
		 * 是否阻止递归。
		 * @type {boolean}
		 * @default false
		 */
		prevent_recursion: false,
		/**
		 * 扫描深度上限。
		 * @type {number}
		 * @default null
		 */
		scan_depth: null,
		/**
		 * 是否整词匹配。
		 * @type {boolean}
		 * @default null
		 */
		match_whole_words: null,
		/**
		 * 是否区分大小写。
		 * @type {boolean}
		 * @default null
		 */
		case_sensitive: null,
		/**
		 * 自动化 ID。
		 * @type {string}
		 */
		automation_id: '',
		/**
		 * 消息角色。
		 * @type {number}
		 * @default 0
		 */
		role: 0,
		/**
		 * 是否已向量化。
		 * @type {boolean}
		 * @default false
		 */
		vectorized: false,
		/**
		 * 粘性计数。
		 * @type {number}
		 * @default 0
		 */
		sticky: 0,
		/**
		 * 触发延迟至第 N 次递归。
		 * @type {number}
		 * @default 0
		 */
		delay_until_recursion: 0,
		/**
		 * 冷却时间。
		 * @type {number}
		 * @default 0
		 */
		cooldown: 0,
	}
}
/** 世界信息手册。 */
export class WorldInfoBook {
	/**
	 * 手册名称。
	 * @type {string}
	 */
	name
	/**
	 * 条目列表。
	 * @type {WorldInfoEntry[]}
	 */
	entries
}
/** 正则表达式脚本信息。 */
export class regex_script_info {
	/**
	 * 脚本名称。
	 * @type {string}
	 */
	scriptName
	/**
	 * 查找正则。
	 * @type {string}
	 */
	findRegex
	/**
	 * 替换字符串。
	 * @type {string}
	 */
	replaceString
	/**
	 * 修剪字符串列表。
	 * @type {string[]}
	 */
	trimStrings
	/**
	 * 应用位置。
	 * @type {number[]}
	 */
	placement
	/**
	 * 是否禁用。
	 * @type {boolean}
	 */
	disabled
	/**
	 * 是否仅处理 Markdown。
	 * @type {boolean}
	 */
	markdownOnly
	/**
	 * 是否仅处理提示词。
	 * @type {boolean}
	 */
	promptOnly
	/**
	 * 是否在编辑时运行。
	 * @type {boolean}
	 */
	runOnEdit
	/**
	 * 是否替换正则。
	 * @type {boolean}
	 */
	substituteRegex
	/**
	 * 最小深度。
	 * @type {number}
	 */
	minDepth
	/**
	 * 最大深度。
	 * @type {number}
	 */
	maxDepth
}
/** V2 角色数据。 */
export class v2CharData {
	/**
	 * 角色名称。
	 * @type {string}
	 */
	name
	/**
	 * 角色描述。
	 * @type {string}
	 */
	description
	/**
	 * 角色版本。
	 * @type {string}
	 */
	character_version
	/**
	 * 角色性格简述。
	 * @type {string}
	 */
	personality
	/**
	 * 场景描述。
	 * @type {string}
	 */
	scenario
	/**
	 * 开场白。
	 * @type {string}
	 */
	first_mes
	/**
	 * 对话示例。
	 * @type {string}
	 */
	mes_example
	/**
	 * 创作者备注。
	 * @type {string}
	 */
	creator_notes
	/**
	 * 标签列表。
	 * @type {string[]}
	 */
	tags
	/**
	 * 系统提示词覆盖。
	 * @type {string}
	 */
	system_prompt
	/**
	 * 历史后指令。
	 * @type {string}
	 */
	post_history_instructions
	/**
	 * 创作者名称。
	 * @type {string}
	 */
	creator
	/**
	 * 创建者标识。
	 * @type {string}
	 */
	create_by
	/**
	 * 可选问候语列表。
	 * @type {string[]}
	 */
	alternate_greetings
	/** 扩展数据。 */
	extensions = {
		/**
		 * 健谈度。
		 * @type {number}
		 */
		talkativeness: 0.5,
		/**
		 * 是否收藏。
		 * @type {boolean}
		 */
		fav: false,
		/**
		 * 关联世界。
		 * @type {string}
		 */
		world: '',
		/** 深度提示词。 */
		depth_prompt: {
			/**
			 * 深度。
			 * @type {number}
			 */
			depth: 4,
			/**
			 * 提示词。
			 * @type {string}
			 */
			prompt: '',
			/**
			 * 消息角色。
			 * @type {"system" | "user" | "assistant"}
			 */
			role: 'system'
		},
		/**
		 * 正则脚本列表。
		 * @type {regex_script_info[]}
		 */
		regex_scripts: [],
	}
	/**
	 * 角色世界信息手册。
	 * @type {WorldInfoBook}
	 */
	character_book
}
/** V1 角色数据。 */
export class v1CharData {
	/**
	 * 角色名称。
	 * @type {string}
	 */
	name
	/**
	 * 角色描述。
	 * @type {string}
	 */
	description
	/**
	 * 角色性格简述。
	 * @type {string}
	 */
	personality
	/**
	 * 场景描述。
	 * @type {string}
	 */
	scenario
	/**
	 * 开场白。
	 * @type {string}
	 */
	first_mes
	/**
	 * 对话示例。
	 * @type {string}
	 */
	mes_example
	/**
	 * 创作者备注。
	 * @type {string}
	 */
	creatorcomment
	/**
	 * 标签列表。
	 * @type {string[]}
	 */
	tags
	/**
	 * 健谈度。
	 * @type {number}
	 */
	talkativeness
	/**
	 * 是否收藏。
	 * @type {boolean}
	 */
	fav
	/**
	 * 创建日期。
	 * @type {string}
	 */
	create_date
	/**
	 * V2 数据扩展。
	 * @type {v2CharData}
	 */
	data
}
const move_pepos = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'tags', 'create_by', 'create_date']
const extension_pepos = ['talkativeness', 'fav']
/**
 * 从 V2 角色数据提取 V1 格式。
 * @param {v2CharData} data 包含角色信息的 V2 数据对象。
 * @returns {v1CharData} 从 V2 数据提取的 V1 角色数据。
 */
export function GetV1CharDataFromV2(data) {
	/**
	 * V1 角色数据对象。
	 * @type {v1CharData}
	 */
	let aret = {}
	for (const key of move_pepos) if (data[key]) aret[key] = data[key]
	for (const key of extension_pepos) aret[key] = data.extensions[key]
	aret = {
		...aret,
		creatorcomment: data.creator_notes,
		avatar: 'none',
		spec: 'chara_card_v2',
		spec_version: '2.0',
		data
	}

	delete data.create_date
	return aret
}
/**
 * 从 V1 角色数据提取 V2 格式。
 * @param {v1CharData} data 包含角色信息的 V1 数据对象。
 * @returns {v2CharData} 从 V1 数据提取的 V2 角色数据。
 */
export function GetV2CharDataFromV1(data) {
	if (data.data) return data.data
	/**
	 * V2 角色数据对象。
	 * @type {v2CharData}
	 */
	const aret = { extensions: {} }
	for (const key of move_pepos) if (data[key]) aret[key] = data[key]
	for (const key of extension_pepos) aret.extensions[key] = data[key]
	aret.creator_notes = data.creatorcomment
	delete aret.create_date
	data.data = aret
	return aret
}
