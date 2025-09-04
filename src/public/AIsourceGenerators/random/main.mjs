/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { FullProxy } from 'npm:full-proxy'

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'

export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'weighted random',
	provider: 'unknown',
	sources: [
		{
			weight: 2,
			source: 'source name1',
		},
		{
			weight: 3,
			source: 'source name2',
		},
		{
			weight: 5,
			source: {
				generator: 'some generator',
				config: {
					model_name: 'some_model',
					other_datas: '...'
				}
			}
		}
	],
}

async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const weightedSources = await Promise.all(config.sources.map(async item => {
		if (Object(item.weight) instanceof Number || item.weight <= 0)
			throw new Error(`Source item must have a positive numerical 'weight'. Invalid item: ${JSON.stringify(item.source)}`)
		const sourceInstance = await loadAIsourceFromNameOrConfigData(username, item.source, unnamedSources, {
			SaveConfig
		})
		return {
			weight: item.weight,
			source: sourceInstance
		}
	}))

	if (!weightedSources.length)
		throw new Error('no source configured')

	const selectSourceByWeight = () => {
		const totalWeight = weightedSources.reduce((sum, s) => sum + s.weight, 0)
		let randomValue = Math.random() * totalWeight

		for (const weightedSource of weightedSources) {
			randomValue -= weightedSource.weight
			if (randomValue <= 0)
				return weightedSource.source
		}
	}


	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name,
				provider: config.provider || 'unknown',
				description: 'Selects a source randomly based on configured weights.',
				description_markdown: 'Selects a source randomly based on configured weights.',
				version: '0.0.1',
				author: 'steve02081504',
				home_page: '',
				tags: ['random', 'weighted', 'router'],
			}
		},
		is_paid: weightedSources.some(s => s.source.is_paid),

		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		Call: async prompt => {
			const selectedSource = selectSourceByWeight()
			return await selectedSource.Call(prompt)
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const selectedSource = selectSourceByWeight()
			return await selectedSource.StructCall(prompt_struct)
		},
		tokenizer: new FullProxy(() => selectSourceByWeight().tokenizer),
	}
	return result
}
