import { loadShell } from './shell_manager.mjs'
import { getPartListBase } from '../parts_loader.mjs'
import { LoadChar } from './char_manager.mjs'
import { loadPersona } from './personas_manager.mjs'
import { loadAIsource, loadAIsourceGenerator } from './AIsources_manager.mjs'
import { LoadImportHanlder } from '../../public/shells/install/src/server/importHanlder_manager.mjs'
import { loadWorld } from './world_manager.mjs'

export const partsList = [
	'shells', 'chars', 'personas', 'worlds', 'AIsources', 'AIsourceGenerators',
	'ImportHanlders'
]
let loadMethods = {
	'shells': loadShell,
	'chars': LoadChar,
	'personas': loadPersona,
	'worlds': loadWorld,
	'AIsources': loadAIsource,
	'AIsourceGenerators': loadAIsourceGenerator,
	'ImportHanlders': LoadImportHanlder
}
export function loadPart(username, parttype, partname) {
	return loadMethods[parttype](username, partname)
}

let pathFilters = {
	'AIsources': (file) => file.isFile() && file.name.endsWith('.json')
}
let ResultMappers = {
	'AIsources': (file) => file.name.slice(0, -5)
}
export function getPartList(username, parttype) {
	return getPartListBase(username, parttype, {
		PathFilter: pathFilters[parttype],
		ResultMapper: ResultMappers[parttype]
	})
}
