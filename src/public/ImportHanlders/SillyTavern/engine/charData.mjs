/** @enum {number} */
const world_info_logic = {
	AND_ANY: 0,
	NOT_ALL: 1,
	NOT_ANY: 2,
	AND_ALL: 3,
}
/** @enum {number} */
const world_info_position = {
	before: 0,
	after: 1,
	ANTop: 2,
	ANBottom: 3,
	atDepth: 4,
	EMTop: 5,
	EMBottom: 6,
}
/**
 * @enum {number} Where the regex script should be applied
 */
const regex_placement = {
	/**
	 * @deprecated MD Display is deprecated. Do not use.
	 */
	MD_DISPLAY: 0,
	USER_INPUT: 1,
	AI_OUTPUT: 2,
	SLASH_COMMAND: 3,
	// 4 - sendAs (legacy)
	WORLD_INFO: 5,
}
/** @enum {number} */
const wi_anchor_position = {
	before: 0,
	after: 1,
}
/** @enum {number} */
const extension_prompt_roles = {
	SYSTEM: 0,
	USER: 1,
	ASSISTANT: 2,
}
class WorldInfoEntry {
	/**
	 * the id of the entry
	 * @type {number}
	 */
	id
	/**
	 * the keys of the entry
	 * @type {string[]}
	 */
	keys
	/**
	 * the secondary keys of the entry
	 * @type {string[]}
	 */
	secondary_keys
	/**
	 * the comment of the entry
	 * @type {string}
	 */
	comment
	/**
	 * the content of the entry
	 * @type {string}
	 */
	content
	/**
	 * is this entry a constant
	 * @type {boolean}
	 */
	constant
	/**
	 * is this entry case selective
	 * @type {boolean}
	 */
	selective
	/**
	 * the insertion order of the entry
	 * @type {number}
	 * @default 100
	 */
	insertion_order
	/**
	 * is this entry enabled
	 * @type {boolean}
	 * @default true
	 */
	enabled
	/**
	 * the position of the entry
	 * @type {"before_char" | "after_char" | string}
	 * @default "before_char"
	 */
	position
	/**
	 * the extension datas of the entry
	 */
	extensions = {
		/**
		 * the position of the entry
		 * @type {number}
		 * @default 0
		 */
		position,
		/**
		 * is this entry excluded from recursion
		 * @type {boolean}
		 * @default false
		 */
		exclude_recursion,
		/**
		 * the display index of the entry
		 * @type {number}
		 */
		display_index,
		/**
		 * the probability of the entry
		 * @type {number}
		 * @default 100
		 */
		probability,
		/**
		 * is the probability of the entry used
		 * @type {boolean}
		 * @default true
		 */
		useProbability,
		/**
		 * the depth of the entry
		 * @type {number}
		 * @default 4
		 */
		depth,
		/**
		 * the selective logic of the entry
		 * @type {world_info_logic}
		 * @default 0
		 */
		selectiveLogic,
		/**
		 * the group of the entry
		 * @type {string}
		 */
		group,
		/**
		 * is the group override of the entry
		 * @type {boolean}
		 * @default false
		 */
		group_override,
		/**
		 * is the entry prevented from recursion
		 * @type {boolean}
		 * @default false
		 */
		prevent_recursion,
		/**
		 * the scan depth of the entry
		 * @type {number}
		 * @default null
		 */
		scan_depth,
		/**
		 * is the entry matched with whole words
		 * @type {boolean}
		 * @default null
		 */
		match_whole_words,
		/**
		 * is the entry case sensitive
		 * @type {boolean}
		 * @default null
		 */
		case_sensitive,
		/**
		 * the automation id of the entry
		 * @type {string}
		 */
		automation_id,
		/**
		 * the role of the entry
		 * @type {number}
		 * @default 0
		 */
		role,
		/**
		 * is the entry vectorized
		 * @type {boolean}
		 * @default false
		 */
		vectorized,
		/**
		 * the number of the entry sticky
		 * @type {number}
		 * @default 0
		 */
		sticky,
		/**
		 * the entry's trigger is delayed until Nth recursion
		 * @type {number}
		 * @default 0
		 */
		delay_until_recursion,
		/**
		 * the cooldown of the entry
		 * @type {number}
		 * @default 0
		 */
		cooldown,
	}
}
class WorldInfoBook {
	/**
	 * the name of the book
	 * @type {string}
	 */
	name
	/**
	 * the entries of the book
	 * @type {WorldInfoEntry[]}
	 */
	entries
}
class v2CharData {
	/**
	 * the name of the character
	 * @type {string}
	 */
	name
	/**
	 * the description of the character
	 * @type {string}
	 */
	description
	/**
	 * character's version
	 * @type {string}
	 */
	character_version
	/**
	 * a short personality description of the character
	 * @type {string}
	 */
	personality
	/**
	 * a scenario description of the character
	 * @type {string}
	 */
	scenario
	/**
	 * the first message in the conversation
	 * @type {string}
	 */
	first_mes
	/**
	 * the example message in the conversation
	 * @type {string}
	 */
	mes_example
	/**
	 * creator's notes of the character
	 * @type {string}
	 */
	creator_notes
	/**
	 * the tags of the character
	 * @type {string[]}
	 */
	tags
	/**
	 * system_prompt override
	 * @type {string}
	 */
	system_prompt
	/**
	 * post_history_instructions
	 * @type {string}
	 */
	post_history_instructions
	/**
	 * creator's name
	 * @type {string}
	 */
	creator
	/**
	 * creator's name
	 * @type {string}
	 */
	create_by
	/**
	 * alternate_greetings for user choices
	 * @type {string[]}
	 */
	alternate_greetings
	/**
	 * extra data
	 */
	extensions = {
		/**
		 * talkativeness
		 * @type {number}
		 */
		talkativeness,
		/**
		 * fav
		 * @type {boolean}
		 */
		fav,
		/**
		 * world
		 * @type {string}
		 */
		world,
		/**
		 * depth_prompt
		 */
		depth_prompt: {
			/**
			 * depth
			 * @type {number}
			 */
			depth,
			/**
			 * prompt
			 * @type {string}
			 */
			prompt,
			/**
			 * role
			 * @type {"system" | "user" | "assistant"}
			 */
			role
		},
		/**
		 * regex_scripts
		 */
		regex_scripts: [{
			/**
			 * the name of the script
			 * @type {string}
			 */
			scriptName,
			/**
			 * the find regex
			 * @type {string}
			 */
			findRegex,
			/**
			 * the replace string
			 * @type {string}
			 */
			replaceString,
			/**
			 * the trim strings
			 * @type {string[]}
			 */
			trimStrings,
			/**
			 * the placement
			 * @type {number[]}
			 */
			placement,
			/**
			 * is the script disabled
			 * @type {boolean}
			 */
			disabled,
			/**
			 * is the script markdown only
			 * @type {boolean}
			 */
			markdownOnly,
			/**
			 * is the script prompt only
			 * @type {boolean}
			 */
			promptOnly,
			/**
			 * is the script run on edit
			 * @type {boolean}
			 */
			runOnEdit,
			/**
			 * is the script substitute regex
			 * @type {boolean}
			 */
			substituteRegex,
			/**
			 * the min depth
			 * @type {number}
			 */
			minDepth,
			/**
			 * the max depth
			 * @type {number}
			 */
			maxDepth
		}]
	}
	/**
	 * the charbook
	 * @type {WorldInfoBook}
	 */
	character_book
}
class v1CharData {
	/**
	 * the name of the character
	 * @type {string}
	 */
	name
	/**
	 * the description of the character
	 * @type {string}
	 */
	description
	/**
	 * a short personality description of the character
	 * @type {string}
	 */
	personality
	/**
	 * a scenario description of the character
	 * @type {string}
	 */
	scenario
	/**
	 * the first message in the conversation
	 * @type {string}
	 */
	first_mes
	/**
	 * the example message in the conversation
	 * @type {string}
	 */
	mes_example
	/**
	 * creator's notes of the character
	 * @type {string}
	 */
	creatorcomment
	/**
	 * the tags of the character
	 * @type {string[]}
	 */
	tags
	/**
	 * talkativeness
	 * @type {number}
	 */
	talkativeness
	/**
	 * fav
	 * @type {boolean}
	 */
	fav
	/**
	 * create_date
	 * @type {string}
	 */
	create_date
	/**
	 * v2 data extension
	 * @type {v2CharData}
	 */
	data
}
const move_pepos = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'tags', 'create_by', 'create_date']
const extension_pepos = ['talkativeness', 'fav']
/**
 * Retrieves V1 character data from V2 data.
 *
 * @param {v2CharData} data - The V2 data object containing character information.
 * @return {v1CharData} The V1 character data extracted from the V2 data.
 */
function GetV1CharDataFromV2(data) {
	/** @type {v1CharData} */
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
 * Retrieves V2 character data from V1 data.
 *
 * @param {v1CharData} data - The V1 data object containing character information.
 * @returns {v2CharData} The V2 character data extracted from the V1 data.
 */
function GetV2CharDataFromV1(data) {
	if (data.data) return data.data
	/** @type {v2CharData} */
	const aret = { extensions: {} }
	for (const key of move_pepos) if (data[key]) aret[key] = data[key]
	for (const key of extension_pepos) aret.extensions[key] = data[key]
	aret.creator_notes = data.creatorcomment
	delete aret.create_date
	data.data = aret
	return aret
}
export {
	v2CharData, v1CharData, GetV1CharDataFromV2, GetV2CharDataFromV1, WorldInfoBook, WorldInfoEntry,
	regex_placement, world_info_logic, world_info_position, wi_anchor_position, extension_prompt_roles
}
