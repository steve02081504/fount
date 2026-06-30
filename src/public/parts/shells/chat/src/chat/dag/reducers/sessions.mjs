import { createEmptySessionState, withGroupId } from './helpers.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const sessionReducers = {
	/**
	 * 处理 `session_world_bind` 事件：设置群级默认世界绑定。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	session_world_bind(state, event) {
		withGroupId(state, event)
		if (!state.session) state.session = createEmptySessionState()
		state.session.world = {
			worldname: String(event.content?.worldname || '').trim(),
			ownerUsername: String(event.content?.ownerUsername || '').trim(),
			homeNodeHash: event.content?.homeNodeHash || '',
		}
		return state
	},

	/**
	 * 处理 `session_world_bind_channel` 事件：为指定频道写入世界绑定。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	session_world_bind_channel(state, event) {
		withGroupId(state, event)
		if (!state.session) state.session = createEmptySessionState()
		const channelId = String(event.content?.channelId || '').trim()
		if (channelId)
			state.session.channelWorlds[channelId] = {
				worldname: String(event.content?.worldname || '').trim(),
				ownerUsername: String(event.content?.ownerUsername || '').trim(),
				homeNodeHash: event.content?.homeNodeHash || '',
			}

		return state
	},

	/**
	 * 处理 `session_world_clear` 事件：清除频道或群级世界绑定。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	session_world_clear(state, event) {
		withGroupId(state, event)
		if (!state.session) return state
		const channelId = String(event.content?.channelId || '').trim()
		if (channelId) delete state.session.channelWorlds[channelId]
		else state.session.world = null
		return state
	},

	/**
	 * 处理 `session_persona_set` 事件：设置或清除用户的 persona 绑定。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	session_persona_set(state, event) {
		withGroupId(state, event)
		if (!state.session) state.session = createEmptySessionState()
		const ownerUsername = String(event.content?.ownerUsername || '').trim()
		if (ownerUsername) {
			const personaname = event.content?.personaname
			if (personaname == null || personaname === '')
				delete state.session.personas[ownerUsername]
			else
				state.session.personas[ownerUsername] = String(personaname).trim()
		}
		return state
	},

	/**
	 * 处理 `session_plugin_add` 事件：向用户插件列表追加插件。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	session_plugin_add(state, event) {
		withGroupId(state, event)
		if (!state.session) state.session = createEmptySessionState()
		const ownerUsername = String(event.content?.ownerUsername || '').trim()
		const pluginname = String(event.content?.pluginname || '').trim()
		if (ownerUsername && pluginname) {
			if (!state.session.plugins[ownerUsername])
				state.session.plugins[ownerUsername] = []
			if (!state.session.plugins[ownerUsername].includes(pluginname))
				state.session.plugins[ownerUsername].push(pluginname)
		}
		return state
	},

	/**
	 * 处理 `session_plugin_remove` 事件：从用户插件列表移除插件。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	session_plugin_remove(state, event) {
		withGroupId(state, event)
		if (!state.session) return state
		const ownerUsername = String(event.content?.ownerUsername || '').trim()
		const pluginname = String(event.content?.pluginname || '').trim()
		if (ownerUsername && pluginname) {
			const list = state.session.plugins[ownerUsername]
			if (Array.isArray(list)) {
				state.session.plugins[ownerUsername] = list.filter(name => name !== pluginname)
				if (!state.session.plugins[ownerUsername].length)
					delete state.session.plugins[ownerUsername]
			}
		}
		return state
	},
}
