import fs from 'node:fs'
import { join } from 'node:path'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData, loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

const watchedDirs = new Set()
let registryLastChanged = Date.now()

async function loadAchievementsRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry', {})

	const partTypesToScan = ['shells', 'chars', 'worlds', 'personas', 'plugins']

	for (const partType of partTypesToScan) {
		const part_list = await getPartListBase(username, partType)
		for (const partName of part_list) try {
			const dirPath = GetPartPath(username, partType, partName)
			const registryPath = join(dirPath, 'achievements_registry.json')
			if (!fs.existsSync(registryPath)) continue

			if (!watchedDirs.has(dirPath)) try {
				fs.watch(dirPath, (eventType, filename) => {
					if (filename !== 'achievements_registry.json') return
					console.log(`Achievements registry file changed in dir: ${dirPath}. Invalidating caches on next request.`)
					registryLastChanged = Date.now()
					sendEventToUser(username, 'achievements-registry-updated', null)
				})
				watchedDirs.add(dirPath)
			} catch (e) {
				console.error(`Failed to set up watch on ${dirPath}:`, e)
			}

			const partRegistry = loadJsonFile(registryPath)
			if (partRegistry.achievements) {
				if (!registry[partType])
					registry[partType] = {}

				if (!registry[partType][partName])
					registry[partType][partName] = {}

				Object.assign(registry[partType][partName], partRegistry.achievements)
			}
		} catch (e) {
			console.error(`Error loading achievement registry from ${partType}/${partName}:`, e)
		}
	}
}

async function expandAchievementsRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!registry.lastLoaded || registry.lastLoaded < registryLastChanged) {
		for (const key in registry)
			delete registry[key]

		await loadAchievementsRegistry(username)
		registry.lastLoaded = Date.now()
	}

	return registry
}

function getUserAchievementData(username) {
	const data = loadShellData(username, 'achievements', 'data')
	data.unlocked ??= {}
	return data
}

export async function getAchievements(username) {
	const defs = await expandAchievementsRegistry(username)
	const userData = getUserAchievementData(username)

	const achievementsData = {}

	for (const partType in defs)
		for (const partName in defs[partType]) {
			const achievements = defs[partType][partName]
			for (const id in achievements)
				((achievementsData[partType] ??= {})[partName] ??= {})[id] = {
					...achievements[id],
					unlocked_at: userData.unlocked[partType]?.[partName]?.[id] || undefined,
				}

		}


	return achievementsData
}

export async function unlockAchievement(username, parttype, partname, achievementId) {
	const registry = await expandAchievementsRegistry(username)
	const achievement = registry[parttype]?.[partname]?.[achievementId]

	if (!achievement)
		return { success: false, message: 'Achievement not found.' }

	const data = getUserAchievementData(username)
	if (data.unlocked[parttype]?.[partname]?.[achievementId])
		return { success: false, message: 'Achievement already unlocked.' }

	const unlockedTime = new Date().toISOString()
	if (!data.unlocked[parttype])
		data.unlocked[parttype] = {}

	if (!data.unlocked[parttype][partname])
		data.unlocked[parttype][partname] = {}

	data.unlocked[parttype][partname][achievementId] = unlockedTime
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

export async function lockAchievement(username, parttype, partname, achievementId) {
	const registry = await expandAchievementsRegistry(username)
	const achievement = registry[parttype]?.[partname]?.[achievementId]

	if (!achievement)
		return { success: false, message: 'Achievement not found.' }

	const data = getUserAchievementData(username)
	if (!data.unlocked[parttype]?.[partname]?.[achievementId])
		return { success: false, message: 'Achievement not unlocked.' }

	delete data.unlocked[parttype][partname][achievementId]

	if (Object.keys(data.unlocked[parttype][partname]).length === 0)
		delete data.unlocked[parttype][partname]

	if (Object.keys(data.unlocked[parttype]).length === 0)
		delete data.unlocked[parttype]


	saveShellData(username, 'achievements', 'data')

	return { success: true }
}

export function onPartChanged({ username, parttype, partname }) {
	registryLastChanged = Date.now()
	sendEventToUser(username, 'achievements-registry-updated', null)
}
