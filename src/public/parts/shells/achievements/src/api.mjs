import { httpError } from '../../../../../scripts/http_error.mjs'
import { getPartDetails } from '../../../../../server/parts_loader.mjs'
import { loadRegistryJsonEntries } from '../../../../../server/registries.mjs'
import { loadShellData, saveShellData, loadTempData } from '../../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../../server/web_server/event_dispatcher.mjs'

/**
 * @param {string} username
 * @returns {Promise<void>}
 */
async function buildRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	for (const key in registry) delete registry[key]

	const loaded = await loadRegistryJsonEntries(username, 'achievements')
	for (const { entry, data } of loaded) {
		if (entry.partpath && data && typeof data === 'object')
			registry[entry.partpath] = data
	}
}

/**
 * 获取指定用户的成就注册表，如果不存在则构建它。
 * @param {string} username - 用户的名称。
 * @returns {Promise<object>} - 返回成就注册表对象。
 */
async function getAchievementsRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!Object.keys(registry).length) await buildRegistry(username)
	return registry || {}
}

/**
 * 获取指定用户的成就数据。
 * @param {string} username - 用户的名称。
 * @returns {object} - 返回包含用户已解锁成就的对象。
 */
function getUserAchievementData(username) {
	const data = loadShellData(username, 'achievements', 'data')
	data.unlocked ??= {}
	return data
}

/**
 * 获取指定用户的所有成就的详细信息。
 * @param {string} username - 用户的名称。
 * @returns {Promise<Array<object>>} - 返回一个包含所有成就详细信息的对象数组。
 */
export async function getAllAchievements(username) {
	const registry = await getAchievementsRegistry(username)
	const partpaths = Object.keys(registry).sort()

	const detailedSources = await Promise.all(partpaths.map(async (partpath) => {
		const achievementDefs = registry[partpath] || {}
		const partDetails = await getPartDetails(username, partpath)
		const userData = getUserAchievementData(username)

		const achievements = {}
		for (const id in achievementDefs)
			achievements[id] = {
				...achievementDefs[id],
				unlocked_at: userData.unlocked[partpath]?.[id] || undefined,
			}


		return {
			partpath,
			info: partDetails.info,
			achievements,
		}
	}))

	return detailedSources
}

/**
 * 为指定用户解锁一个成就。
 * @param {string} username - 用户的名称。
 * @param {string} partpath - 成就所属部件的路径。
 * @param {string} achievementId - 要解锁的成就的ID。
 * @returns {Promise<object>} - 返回一个包含操作结果的对象。
 */
export async function unlockAchievement(username, partpath, achievementId) {
	const registry = await getAchievementsRegistry(username)
	const achievement = registry[partpath]?.[achievementId]

	if (!achievement)
		throw httpError(404, 'Achievement not found.')

	const data = getUserAchievementData(username)
	if (data.unlocked[partpath]?.[achievementId])
		return { message: 'Achievement already unlocked.' }

	const unlockedTime = new Date().toISOString();
	(data.unlocked[partpath] ??= {})[achievementId] = unlockedTime
	saveShellData(username, 'achievements', 'data')

	const unlockedAchievement = {
		...achievement,
		id: achievementId,
		unlocked_at: unlockedTime,
	}

	const toastHtml = /* html */ `\
<a href="/parts/shells:achievements/" rel="noopener" class="alert alert-success shadow-lg flex items-end opacity-80">
	<div class="flex-none w-12 h-12 mr-2">
		<img src="${unlockedAchievement.icon}" class="h-full w-full aspect-square" />
	</div>
	<div class="flex-grow">
		<div class="text-xs mb-1" data-i18n="achievements.toast_title"></div>
		<h3 class="font-bold text-lg" data-i18n="${unlockedAchievement.name}"></h3>
		<p class="text-sm" data-i18n="${unlockedAchievement.description}"></p>
	</div>
</a>
`

	sendEventToUser(username, 'show-toast', {
		type: 'custom',
		message: toastHtml,
		duration: 6000,
	})

	sendEventToUser(username, 'achievement-unlocked', { achievement: unlockedAchievement })

	return {
		achievement: {
			[achievementId]: unlockedAchievement,
		},
	}
}

/**
 * 为指定用户锁定一个成就。
 * @param {string} username - 用户的名称。
 * @param {string} partpath - 成就所属部件的路径。
 * @param {string} achievementId - 要锁定的成就的ID。
 * @param {string} [reason] - 锁定成就的原因。
 * @returns {Promise<object>} - 返回一个包含操作结果的对象。
 */
export async function lockAchievement(username, partpath, achievementId, reason) {
	const registry = await getAchievementsRegistry(username)
	const achievement = registry[partpath]?.[achievementId]

	if (!achievement)
		throw httpError(404, 'Achievement not found.')

	const data = getUserAchievementData(username)
	if (!data.unlocked[partpath]?.[achievementId])
		return { message: 'Achievement not unlocked.' }

	delete data.unlocked[partpath][achievementId]

	if (!Object.keys(data.unlocked[partpath]).length)
		delete data.unlocked[partpath]

	saveShellData(username, 'achievements', 'data')

	if (reason === 'relock_by_clicking')
		await unlockAchievement(username, 'shells/achievements', 'relock_by_clicking')

	return {}
}

/**
 * 当一个部件被安装时调用，用于更新成就注册表。
 * @param {object} root0 - 参数对象。
 * @param {string} root0.username - 用户的名称。
 * @param {string} root0.partpath - 已安装部件的路径。
 * @returns {Promise<void>}
 */
export async function onPartInstalled({ username, partpath }) {
	await getAchievementsRegistry(username)
	updatePartInRegistry(username, partpath)
	watchRegistryFile(username, partpath)
}

/**
 * 当一个部件被卸载时调用，用于更新成就注册表。
 * @param {object} root0 - 参数对象。
 * @param {string} root0.username - 用户的名称。
 * @param {string} root0.partpath - 已卸载部件的路径。
 */
export function onPartUninstalled({ username, partpath }) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!registry || !registry[partpath]) return

	delete registry[partpath]
	sendEventToUser(username, 'achievements-registry-updated', null)
}
