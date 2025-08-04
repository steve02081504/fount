import { loadJsonFile, saveJsonFile } from '../../scripts/json_loader.mjs'
import { getUserDictionary } from '../auth.mjs'
import { getDefaultParts, isPartLoaded, loadPartBase, unloadPartBase } from '../parts_loader.mjs'
import { skip_report } from '../server.mjs'

function GetPath(username, partname) {
	return getUserDictionary(username) + '/AIsources/' + partname
}

/**
 * @param {string} username
 * @param {string} AIsourcename
 * @returns {Promise<import('../../decl/AIsourceGenerator.ts').AIsourceGenerator_t>}
 */
export async function loadAIsourceGenerator(username, AIsourcename) {
	return loadPartBase(username, 'AIsourceGenerators', AIsourcename)
}

export async function unloadAIsourceGenerator(username, AIsourcename) {
	await unloadPartBase(username, 'AIsourceGenerators', AIsourcename)
}

export async function loadAIsourceFromConfigData(username, data, { SaveConfig }) {
	const generator = await loadAIsourceGenerator(username, data.generator)
	return await generator.interfaces.AIsource.GetSource(data.config, {
		username,
		SaveConfig
	})
}

export async function loadAIsource(username, AIsourcename) {
	return loadPartBase(username, 'AIsources', AIsourcename, null, {
		pathGetter: () => GetPath(username, AIsourcename),
		Loader: async (path) => {
			let data
			try { data = loadJsonFile(path + '.json') }
			catch (e) { throw skip_report(e) }
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

export async function loadAIsourceFromNameOrConfigData(username, nameOrData, unnamedSources, { SaveConfig }) {
	if (Object(nameOrData) instanceof String)
		return loadAIsource(username, nameOrData)
	else
		return unnamedSources[unnamedSources.push(loadAIsourceFromConfigData(username, nameOrData, { SaveConfig })) - 1]
}

export async function unloadAIsource(username, AIsourcename) {
	await unloadPartBase(username, 'AIsources', AIsourcename, {}, {
		pathGetter: () => GetPath(username, AIsourcename),
		afterUnload: _ => 0
	})
}

export function isAIsourceLoaded(username, AIsourcename) {
	return isPartLoaded(username, 'AIsources', AIsourcename)
}

export async function reloadAIsource(username, AIsourcename) {
	await unloadAIsource(username, AIsourcename)
	await loadAIsource(username, AIsourcename)
}

export async function loadDefaultAIsource(username) {
	const defaultAIsourceName = getDefaultParts(username).AIsources
	if (!defaultAIsourceName) return
	return loadAIsource(username, defaultAIsourceName)
}
