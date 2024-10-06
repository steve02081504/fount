import { loadJsonFile } from './json_loader.mjs'
import { loadPart, unloadPart } from './parts_loader.mjs'

/** @type {Record<string, Record<string, import('../decl/AIsource.ts').AIsource_t>>} */
let AIsources_set = {}
export async function loadAIsource(username, AIsourcename) {
	loadPart(username, 'AIsources', AIsourcename, {
		Loader: async (path) => {
			const data = loadJsonFile(path + '.json')
			let genarator = await loadPart(username, 'AIsourceGenerators', data.generator)
			let AIsource = await genarator.GetSource(data.config)
			return AIsource
		},
	})
}

export function unloadAIsource(username, AIsourcename) {
	unloadPart(username, 'AIsources', AIsourcename)
}
