/**
 * 时间切片与部件加载（fromJSON / runtime 共用）。
 */
import {
	ignoreMissingPartLoadError,
	loadCharMapFromNames,
	loadPlayerFields,
	loadPluginMap,
	loadWorldFields,
} from './timeSliceParts.mjs'

/**
 * 忽略部件路径不存在导致的加载错误（自 timeSliceParts 再导出）。
 */
export { ignoreMissingPartLoadError }

/**
 * 从持久化 JSON 恢复时间切片字段并加载部件 API。
 * @param {object} json 序列化对象
 * @param {string} username 所属用户
 * @returns {Promise<object>} 可 Object.assign 到 timeSlice_t 的字段
 */
export async function hydrateTimeSlice(json, username) {
	const [chars, plugins, worldFields, playerFields] = await Promise.all([
		loadCharMapFromNames(username, json.chars || []),
		loadPluginMap(username, json.plugins || []),
		loadWorldFields(username, json.world),
		loadPlayerFields(username, json.player),
	])
	return {
		...json,
		chars,
		plugins,
		world_id: worldFields.world_id,
		world: worldFields.world,
		player_id: playerFields.player_id,
		player: playerFields.player,
	}
}
