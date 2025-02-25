import { loadShell } from './shell_manager.mjs'
import { getPartListBase } from '../parts_loader.mjs'
import { LoadChar } from './char_manager.mjs'
import { loadPersona } from './personas_manager.mjs'
import { loadAIsource, loadAIsourceGenerator } from './AIsources_manager.mjs'
import { LoadImportHandler } from '../../public/shells/install/src/server/importHandler_manager.mjs'
import { loadWorld } from './world_manager.mjs'

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
