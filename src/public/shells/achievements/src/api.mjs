import fs from 'node:fs'
import { join } from 'node:path'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { partTypeList } from '../../../../server/managers/base.mjs'
import { getPartDetails, getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData, loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

const watchedDirs = new Set()

/**
 * 更新缓存注册表中的单个部件成就。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
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
 * 监视注册表文件的更改。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
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
 * 首次为用户构建整个注册表。
 * @param {string} username - 用户名。
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
 * 获取成就注册表。
 * @param {string} username - 用户名。
 * @returns {Promise<object>} - 成就注册表。
 */
async function getAchievementsRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!Object.keys(registry).length) await buildRegistry(username)
	return registry || {}
}

/**
 * 获取用户成就数据。
 * @param {string} username - 用户名。
 * @returns {object} - 用户成就数据。
 */
function getUserAchievementData(username) {
	const data = loadShellData(username, 'achievements', 'data')
	data.unlocked ??= {}
	return data
}

/**
 * 获取所有成就。
 * @param {string} username - 用户名。
 * @returns {Promise<Array<object>>} - 所有成就的详细信息。
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
 * 解锁成就。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @param {string} achievementId - 成就ID。
 * @returns {Promise<object>} - 解锁结果。
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

	const toastHtml = `\
<a href="/shells/achievements/" class="alert alert-success shadow-lg flex items-end opacity-80">
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
 * 锁定成就。
 * @param {string} username - 用户名。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @param {string} achievementId - 成就ID。
 * @returns {Promise<object>} - 锁定结果。
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
 * 部件安装时调用。
 * @param {object} root0 - 参数。
 * @param {string} root0.username - 用户名。
 * @param {string} root0.parttype - 部件类型。
 * @param {string} root0.partname - 部件名称。
 * @returns {Promise<void>}
 */
export async function onPartInstalled({ username, parttype, partname }) {
	await getAchievementsRegistry(username)
	updatePartInRegistry(username, parttype, partname)
	watchRegistryFile(username, parttype, partname)
}

/**
 * 部件卸载时调用。
 * @param {object} root0 - 参数。
 * @param {string} root0.username - 用户名。
 * @param {string} root0.parttype - 部件类型。
 * @param {string} root0.partname - 部件名称。
 */
export function onPartUninstalled({ username, parttype, partname }) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!registry || !registry[parttype]?.[partname]) return

	delete registry[parttype][partname]
	if (!Object.keys(registry[parttype]).length) delete registry[parttype]
	sendEventToUser(username, 'achievements-registry-updated', null)
}
