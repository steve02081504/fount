import fs from 'node:fs'
import { join } from 'node:path'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { partTypeList } from '../../../../server/managers/base.mjs'
import { getPartDetails, getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData, loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

const watchedDirs = new Set()

/**
 * 更新指定用户缓存的成就注册表中的单个部件。
 * @param {string} username - 用户的名称。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 */
function updatePartInRegistry(username, parttype, partname) {
	const registry = loadTempData(username, 'achievements_registry')
	const dirPath = GetPartPath(username, parttype, partname)
	const registryPath = join(dirPath, 'achievements_registry.json')

	const partExistsInRegistry = !!registry[parttype]?.[partname]
	if (fs.existsSync(registryPath)) {
		const partRegistry = loadJsonFile(registryPath)
		if (partRegistry.achievements)
			(registry[parttype] ??= {})[partname] = partRegistry.achievements

		else if (partExistsInRegistry) {
			delete registry[parttype][partname]
			if (!Object.keys(registry[parttype]).length) delete registry[parttype]
		}
		else return
	}
	else if (partExistsInRegistry) {
		delete registry[parttype][partname]
		if (!Object.keys(registry[parttype]).length) delete registry[parttype]
	}
	else return

	sendEventToUser(username, 'achievements-registry-updated', null)
}

/**
 * 监视指定部件的成就注册表文件的更改。
 * @param {string} username - 用户的名称。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 */
function watchRegistryFile(username, parttype, partname) {
	const dirPath = GetPartPath(username, parttype, partname)
	if (!watchedDirs.has(dirPath)) try {
		fs.watch(dirPath, (eventType, filename) => {
			if (filename !== 'achievements_registry.json') return
			console.log(`Achievements registry file changed in dir: ${dirPath}. Reloading.`)
			updatePartInRegistry(username, parttype, partname)
		})
		watchedDirs.add(dirPath)
	} catch (e) {
		console.error(`Failed to set up watch on ${dirPath}:`, e)
	}
}

/**
 * 为指定用户首次构建完整的成就注册表。
 * @param {string} username - 用户的名称。
 * @returns {Promise<void>}
 */
async function buildRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	// Clear existing registry to ensure it's fresh
	for (const key in registry) delete registry[key]

	for (const parttype of partTypeList) {
		const partList = await getPartListBase(username, parttype)
		for (const partname of partList)
			try {
				const dirPath = GetPartPath(username, parttype, partname)
				const registryPath = join(dirPath, 'achievements_registry.json')

				if (fs.existsSync(registryPath)) {
					const partRegistry = loadJsonFile(registryPath)
					if (partRegistry.achievements)
						(registry[parttype] ??= {})[partname] = partRegistry.achievements
				}
				watchRegistryFile(username, parttype, partname)
			} catch (e) {
				console.error(`Error loading achievement registry from ${parttype}/${partname}:`, e)
			}
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
	const defs = await getAchievementsRegistry(username)
	const sources = []
	for (const parttype in defs)
		for (const partname in defs[parttype])
			sources.push({ parttype, partname })

	sources.sort((a, b) => a.partname.localeCompare(b.partname))

	const detailedSources = await Promise.all(sources.map(async (source) => {
		const { parttype, partname } = source
		const registry = await getAchievementsRegistry(username)
		const achievementDefs = registry[parttype]?.[partname] || {}
		const partDetails = await getPartDetails(username, parttype, partname)
		const userData = getUserAchievementData(username)

		const achievements = {}
		for (const id in achievementDefs)
			achievements[id] = {
				...achievementDefs[id],
				unlocked_at: userData.unlocked[parttype]?.[partname]?.[id] || undefined,
			}

		return {
			parttype,
			partname,
			info: partDetails.info,
			achievements,
		}
	}))

	return detailedSources
}

/**
 * 为指定用户解锁一个成就。
 * @param {string} username - 用户的名称。
 * @param {string} parttype - 成就所属部件的类型。
 * @param {string} partname - 成就所属部件的名称。
 * @param {string} achievementId - 要解锁的成就的ID。
 * @returns {Promise<object>} - 返回一个包含操作结果的对象。
 */
export async function unlockAchievement(username, parttype, partname, achievementId) {
	const registry = await getAchievementsRegistry(username)
	const achievement = registry[parttype]?.[partname]?.[achievementId]

	if (!achievement)
		return { success: false, message: 'Achievement not found.' }

	const data = getUserAchievementData(username)
	if (data.unlocked[parttype]?.[partname]?.[achievementId])
		return { success: true, message: 'Achievement already unlocked.' }

	const unlockedTime = new Date().toISOString();
	((data.unlocked[parttype] ??= {})[partname] ??= {})[achievementId] = unlockedTime
	saveShellData(username, 'achievements', 'data')

	const unlockedAchievement = {
		...achievement,
		id: achievementId,
		unlocked_at: unlockedTime,
	}

	const toastHtml = /* html */ `\
<a href="/shells/achievements/" rel="noopener" class="alert alert-success shadow-lg flex items-end opacity-80">
	<div class="flex-none w-12 h-12 mr-2">
		<img src="${unlockedAchievement.icon}" class="h-full w-full aspect-square" />
	</div>
	<div class="flex-grow">
		<div class="text-xs text-gray-500 mb-1" data-i18n="achievements.toast_title"></div>
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
		success: true,
		achievement: {
			[achievementId]: unlockedAchievement,
		},
	}
}

/**
 * 为指定用户锁定一个成就。
 * @param {string} username - 用户的名称。
 * @param {string} parttype - 成就所属部件的类型。
 * @param {string} partname - 成就所属部件的名称。
 * @param {string} achievementId - 要锁定的成就的ID。
 * @returns {Promise<object>} - 返回一个包含操作结果的对象。
 */
export async function lockAchievement(username, parttype, partname, achievementId) {
	const registry = await getAchievementsRegistry(username)
	const achievement = registry[parttype]?.[partname]?.[achievementId]

	if (!achievement)
		return { success: false, message: 'Achievement not found.' }

	const data = getUserAchievementData(username)
	if (!data.unlocked[parttype]?.[partname]?.[achievementId])
		return { success: true, message: 'Achievement not unlocked.' }

	delete data.unlocked[parttype][partname][achievementId]

	if (!Object.keys(data.unlocked[parttype][partname]).length)
		delete data.unlocked[parttype][partname]

	if (!Object.keys(data.unlocked[parttype]).length)
		delete data.unlocked[parttype]

	saveShellData(username, 'achievements', 'data')

	return { success: true }
}

/**
 * 当一个部件被安装时调用，用于更新成就注册表。
 * @param {object} root0 - 参数对象。
 * @param {string} root0.username - 用户的名称。
 * @param {string} root0.parttype - 已安装部件的类型。
 * @param {string} root0.partname - 已安装部件的名称。
 * @returns {Promise<void>}
 */
export async function onPartInstalled({ username, parttype, partname }) {
	await getAchievementsRegistry(username)
	updatePartInRegistry(username, parttype, partname)
	watchRegistryFile(username, parttype, partname)
}

/**
 * 当一个部件被卸载时调用，用于更新成就注册表。
 * @param {object} root0 - 参数对象。
 * @param {string} root0.username - 用户的名称。
 * @param {string} root0.parttype - 已卸载部件的类型。
 * @param {string} root0.partname - 已卸载部件的名称。
 */
export function onPartUninstalled({ username, parttype, partname }) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!registry || !registry[parttype]?.[partname]) return

	delete registry[parttype][partname]
	if (!Object.keys(registry[parttype]).length) delete registry[parttype]
	sendEventToUser(username, 'achievements-registry-updated', null)
}
