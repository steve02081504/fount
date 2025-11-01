import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'
import { loadData, saveData } from '../setting_loader.mjs'

/**
 * 为用户加载角色数据。
 * @param {string} username - 用户的用户名。
 * @param {string} charname - 角色的名称。
 * @returns {object} 角色数据。
 */
function loadCharData(username, charname) {
	const userCharDataSet = loadData(username, 'char_data')
	return userCharDataSet[charname] ??= {
		/** @type {import('../../decl/charAPI.ts').charState_t} */
		state: {
			init_count: 0,
			last_start_time_stamp: 0,
			start_count: 0,
		}
	}
}
/**
 * 为用户保存角色数据。
 * @param {string} username - 用户的用户名。
 * @returns {void}
 */
function saveCharData(username) {
	saveData(username, 'char_data')
}

/**
 * 为用户加载角色。
 * @param {string} username - 用户的用户名。
 * @param {string} charname - 角色的名称。
 * @returns {Promise<import('../../decl/charAPI.ts').CharAPI_t>} 一个解析为已加载角色的承诺。
 */
export async function LoadChar(username, charname) {
	const data = loadCharData(username, charname)
	const char_state = data.state
	const char = await loadPartBase(username, 'chars', charname, {
		username,
		charname,
		state: char_state,
	}, {
		/**
		 * 加载后调用的函数。
		 */
		afterLoad: () => {
			char_state.last_start_time_stamp = Date.now()
			char_state.start_count++
		}
	})
	return char
}

/**
 * 为用户卸载角色。
 * @param {string} username - 用户的用户名。
 * @param {string} charname - 角色的名称。
 * @param {any} reason - 卸载角色的原因。
 * @returns {Promise<void>} 一个在角色卸载后解析的承诺。
 */
export async function UnloadChar(username, charname, reason) {
	await unloadPartBase(username, 'chars', charname, reason)
	saveCharData(username)
}

/**
 * 为用户初始化角色。
 * @param {string} username - 用户的用户名。
 * @param {string} charname - 角色的名称。
 * @returns {Promise<void>} 一个在角色初始化后解析的承诺。
 */
export async function initChar(username, charname) {
	const { state } = loadCharData(username, charname)
	await initPart(username, 'chars', charname, {
		username,
		charname,
		state,
	}, {
		/**
		 * 初始化后调用的函数。
		 * @param {import('../../decl/charAPI.ts').CharAPI_t} char - 初始化的角色。
		 */
		afterInit: async char => {
			state.init_count++
			saveCharData(username)
		}
	})
}

/**
 * 为用户卸载角色。
 * @param {string} username - 用户的用户名。
 * @param {string} charname - 角色的名称。
 * @param {any} reason - 卸载角色的原因。
 * @param {any} from - 卸载请求的来源。
 * @returns {Promise<void>} 一个在角色卸载后解析的承诺。
 */
export async function uninstallChar(username, charname, reason, from) {
	await uninstallPartBase(username, 'chars', charname, { reason, from })
}
