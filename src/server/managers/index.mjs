import { loadShell, unloadShell } from './shell_manager.mjs'
import { getPartListBase, parts_set } from '../parts_loader.mjs'
import { LoadChar, UnloadChar } from './char_manager.mjs'
import { loadPersona, unloadPersona } from './personas_manager.mjs'
import { loadAIsource, loadAIsourceGenerator, unloadAIsource, unloadAIsourceGenerator } from './AIsources_manager.mjs'
import { LoadImportHandler, UnloadImportHandler } from '../../public/shells/install/src/server/importHandler_manager.mjs'
import { loadWorld, unloadWorld } from './world_manager.mjs'
import { on_shutdown } from '../on_shutdown.mjs'

export const partsList = [
	'shells', 'chars', 'personas', 'worlds', 'AIsources', 'AIsourceGenerators',
	'ImportHandlers'
]
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
	return loadMethods[parttype](username, partname)
}

const pathFilters = {
	'AIsources': (file) => file.isFile() && file.name.endsWith('.json')
}
const ResultMappers = {
	'AIsources': (file) => file.name.slice(0, -5)
}
export function getPartList(username, parttype) {
	return getPartListBase(username, parttype, {
		PathFilter: pathFilters[parttype],
		ResultMapper: ResultMappers[parttype]
	})
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
