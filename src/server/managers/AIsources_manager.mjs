import { getUserDictionary } from '../auth.mjs'
import { loadJsonFile, saveJsonFile } from '../../scripts/json_loader.mjs'
import { isPartLoaded, loadPartBase, unloadPart } from '../parts_loader.mjs'

function GetPath(username, partname) {
	return getUserDictionary(username) + '/AIsources/' + partname
}

/**
 * @param {string} username
 * @param {string} AIsourcename
 * @returns {Promise<import('../../decl/AIsourceGenerator.ts').AIsourceGenerator>}
 */
export async function loadAIsourceGenerator(username, AIsourcename) {
	return loadPartBase(username, 'AIsourceGenerators', AIsourcename)
}

export async function loadAIsourceFromConfigData(username, data, { SaveConfig }) {
	const generator = await loadAIsourceGenerator(username, data.generator)
	return await generator.GetSource(data.config, {
		username,
		SaveConfig
	})
}

export async function loadAIsource(username, AIsourcename) {
	return loadPartBase(username, 'AIsources', AIsourcename, null, {
		pathGetter: () => GetPath(username, AIsourcename),
		Loader: async (path) => {
			const data = loadJsonFile(path + '.json')
			const AIsource = await loadAIsourceFromConfigData(username, data, {
				SaveConfig: (newdata = data) => {
					saveJsonFile(path + '.json', newdata)
				}
			})
			AIsource.filename = AIsourcename
			return AIsource
		},
		Initer: () => { }
	})
}

export async function loadAIsourceFromNameOrConfigData(username, nameOrData, { SaveConfig }) {
	if (Object(nameOrData) instanceof String)
		return loadAIsource(username, nameOrData)
	else
		return loadAIsourceFromConfigData(username, nameOrData, { SaveConfig })
}

export async function unloadAIsource(username, AIsourcename) {
	await unloadPart(username, 'AIsources', AIsourcename)
}

export function isAIsourceLoaded(username, AIsourcename) {
	return isPartLoaded(username, 'AIsources', AIsourcename)
}

export async function reloadAIsource(username, AIsourcename) {
	await unloadAIsource(username, AIsourcename)
	await loadAIsource(username, AIsourcename)
}
