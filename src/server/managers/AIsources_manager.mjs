import { getUserDictionary } from '../auth.mjs'
import { loadJsonFile } from '../../scripts/json_loader.mjs'
import { loadPartBase, unloadPart } from '../parts_loader.mjs'

function GetPath(username, partname) {
	return getUserDictionary(username) + '/AIsources/' + partname
}

export async function loadAIsourceGenerator(username, AIsourcename) {
	return loadPartBase(username, 'AIsourceGenerators', AIsourcename)
}

export async function loadAIsource(username, AIsourcename) {
	return loadPartBase(username, 'AIsources', AIsourcename, null, {
		pathGetter: () => GetPath(username, AIsourcename),
		Loader: async (path) => {
			const data = loadJsonFile(path + '.json')
			let generator = await loadAIsourceGenerator(username, data.generator)
			let AIsource = await generator.GetSource(data.config)
			AIsource.filename = AIsourcename
			return AIsource
		},
		Initer: () => { }
	})
}

export function unloadAIsource(username, AIsourcename) {
	unloadPart(username, 'AIsources', AIsourcename)
}
