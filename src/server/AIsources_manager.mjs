import { getUserDictionary } from './auth.mjs'
import { loadJsonFile } from './json_loader.mjs'
import { loadPart, unloadPart } from './parts_loader.mjs'

function GetPath(username, partname) {
	return getUserDictionary(username) + '/AIsources/' + partname
}

export async function loadAIsource(username, AIsourcename) {
	return loadPart(username, 'AIsources', AIsourcename, null, {
		pathGetter: () => GetPath(username, AIsourcename),
		Loader: async (path) => {
			const data = loadJsonFile(path + '.json')
			let generator = await loadPart(username, 'AIsourceGenerators', data.generator)
			let AIsource = await generator.GetSource(data.config)
			return AIsource
		},
		Initer: () => { }
	})
}

export function unloadAIsource(username, AIsourcename) {
	unloadPart(username, 'AIsources', AIsourcename)
}
