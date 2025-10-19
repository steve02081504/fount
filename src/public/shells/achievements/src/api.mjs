import fs from 'node:fs'
import { join } from 'node:path'

import { loadJsonFile } from '../../../../scripts/json_loader.mjs'
import { partTypeList } from '../../../../server/managers/base.mjs'
import { getPartListBase, GetPartPath } from '../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData, loadTempData } from '../../../../server/setting_loader.mjs'
import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

const watchedDirs = new Set()

// Helper to update a single part's achievements in the cached registry
function updatePartInRegistry(username, partType, partName) {
	const registry = loadTempData(username, 'achievements_registry')
	const dirPath = GetPartPath(username, partType, partName)
	const registryPath = join(dirPath, 'achievements_registry.json')

	const partExistsInRegistry = !!registry[partType]?.[partName]
	if (fs.existsSync(registryPath)) {
		const partRegistry = loadJsonFile(registryPath)
		if (partRegistry.achievements)
			(registry[partType] ??= {})[partName] = partRegistry.achievements

		else if (partExistsInRegistry) {
			delete registry[partType][partName]
			if (!Object.keys(registry[partType]).length) delete registry[partType]
		}
		else return
	}
	else if (partExistsInRegistry) {
		delete registry[partType][partName]
		if (!Object.keys(registry[partType]).length) delete registry[partType]
	}
	else return

	sendEventToUser(username, 'achievements-registry-updated', null)
}

// Helper to watch a registry file for changes
function watchRegistryFile(username, partType, partName) {
	const dirPath = GetPartPath(username, partType, partName)
	if (!watchedDirs.has(dirPath)) try {
		fs.watch(dirPath, (eventType, filename) => {
			if (filename !== 'achievements_registry.json') return
			console.log(`Achievements registry file changed in dir: ${dirPath}. Reloading.`)
			updatePartInRegistry(username, partType, partName)
		})
		watchedDirs.add(dirPath)
	} catch (e) {
		console.error(`Failed to set up watch on ${dirPath}:`, e)
	}
}

// Builds the entire registry for a user for the first time.
async function buildRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	// Clear existing registry to ensure it's fresh
	for (const key in registry) delete registry[key]

	for (const partType of partTypeList) {
		const partList = await getPartListBase(username, partType)
		for (const partName of partList)
			try {
				const dirPath = GetPartPath(username, partType, partName)
				const registryPath = join(dirPath, 'achievements_registry.json')

				if (fs.existsSync(registryPath)) {
					const partRegistry = loadJsonFile(registryPath)
					if (partRegistry.achievements)
						(registry[partType] ??= {})[partName] = partRegistry.achievements

				}
				watchRegistryFile(username, partType, partName)
			} catch (e) {
				console.error(`Error loading achievement registry from ${partType}/${partName}:`, e)
			}

	}
}

// Main function to get the achievements registry for a user.
// It will build the registry on the first call for a user.
async function getAchievementsRegistry(username) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!Object.keys(registry).length) await buildRegistry(username)
	return registry || {}
}

function getUserAchievementData(username) {
	const data = loadShellData(username, 'achievements', 'data')
	data.unlocked ??= {}
	return data
}

export async function getAchievements(username) {
	const defs = await getAchievementsRegistry(username)
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
	const registry = await getAchievementsRegistry(username)
	const achievement = registry[parttype]?.[partname]?.[achievementId]

	if (!achievement)
		return { success: false, message: 'Achievement not found.' }

	const data = getUserAchievementData(username)
	if (data.unlocked[parttype]?.[partname]?.[achievementId])
		return { success: false, message: 'Achievement already unlocked.' }

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

export async function lockAchievement(username, parttype, partname, achievementId) {
	const registry = await getAchievementsRegistry(username)
	const achievement = registry[parttype]?.[partname]?.[achievementId]

	if (!achievement)
		return { success: false, message: 'Achievement not found.' }

	const data = getUserAchievementData(username)
	if (!data.unlocked[parttype]?.[partname]?.[achievementId])
		return { success: false, message: 'Achievement not unlocked.' }

	delete data.unlocked[parttype][partname][achievementId]

	if (!Object.keys(data.unlocked[parttype][partname]).length)
		delete data.unlocked[parttype][partname]

	if (!Object.keys(data.unlocked[parttype]).length)
		delete data.unlocked[parttype]

	saveShellData(username, 'achievements', 'data')

	return { success: true }
}

export async function onPartInstalled({ username, parttype, partname }) {
	await getAchievementsRegistry(username)
	updatePartInRegistry(username, parttype, partname)
	watchRegistryFile(username, parttype, partname)
}

export function onPartUninstalled({ username, parttype, partname }) {
	const registry = loadTempData(username, 'achievements_registry')
	if (!registry || !registry[parttype]?.[partname]) return

	delete registry[parttype][partname]
	if (!Object.keys(registry[parttype]).length) delete registry[parttype]
	sendEventToUser(username, 'achievements-registry-updated', null)
}
