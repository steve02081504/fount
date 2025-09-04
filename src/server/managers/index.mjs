import { on_shutdown } from 'npm:on-shutdown'

import { events } from '../events.mjs'
import { getPartListBase, parts_set } from '../parts_loader.mjs'
import { restartor } from '../server.mjs'

import { loadAIsource, loadAIsourceGenerator, unloadAIsource, unloadAIsourceGenerator } from './AIsource_manager.mjs'
import { LoadChar, UnloadChar } from './char_manager.mjs'
import { LoadImportHandler, UnloadImportHandler } from './ImportHandlers_manager.mjs'
import { loadPersona, unloadPersona } from './persona_manager.mjs'
import { loadShell, unloadShell } from './shell_manager.mjs'
import { loadWorld, unloadWorld } from './world_manager.mjs'


const loadMethods = {
	'shells': loadShell,
	'chars': LoadChar,
	'personas': loadPersona,
	'worlds': loadWorld,
	'AIsources': loadAIsource,
	'AIsourceGenerators': loadAIsourceGenerator,
	'ImportHandlers': LoadImportHandler
}
export function loadPart(username, parttype, partname) {
	if (!loadMethods[parttype])
		throw new Error(`Part loader for type "${parttype}" is not registered.`)
	return loadMethods[parttype](username, partname)
}

const pathFilters = {
	'AIsources': file => file.isFile() && file.name.endsWith('.json')
}
const ResultMappers = {
	'AIsources': file => file.name.slice(0, -5)
}
export function getPartList(username, parttype) {
	return getPartListBase(username, parttype, {
		PathFilter: pathFilters[parttype],
		ResultMapper: ResultMappers[parttype]
	})
}
export function getLoadedPartList(username, parttype) {
	return Object.keys(parts_set[username]?.[parttype] ?? {})
}

const unLoadMethods = {
	'shells': unloadShell,
	'chars': UnloadChar,
	'personas': unloadPersona,
	'worlds': unloadWorld,
	'AIsources': unloadAIsource,
	'AIsourceGenerators': unloadAIsourceGenerator,
	'ImportHandlers': UnloadImportHandler
}
export function unloadPart(username, parttype, partname) {
	return unLoadMethods[parttype](username, partname)
}
on_shutdown(async () => {
	for (const username in parts_set)
		for (const parttype in parts_set[username])
			for (const partname in parts_set[username][parttype])
				await unloadPart(username, parttype, partname)
})

// Event Handlers
events.on('BeforeUserDeleted', async ({ username }) => {
	for (const parttype in parts_set[username])
		for (const partname in parts_set[username][parttype])
			await unloadPart(username, parttype, partname)
})

events.on('BeforeUserRenamed', async ({ oldUsername, newUsername }) => {
	for (const parttype in parts_set[oldUsername])
		for (const partname in parts_set[oldUsername][parttype])
			await unloadPart(oldUsername, parttype, partname)
})

export async function reloadPart(username, parttype, partname) {
	restartor() // we ll restart the entire server because fucking deno not support hot reload of signal js file
}
