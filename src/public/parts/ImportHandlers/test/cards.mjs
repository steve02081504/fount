/**
 * 导入器测试用的最小 SillyTavern / Risu 角色卡构造器。
 */
import { Buffer } from 'node:buffer'

import { encode as encodeText } from 'npm:png-chunk-text'
import encodePng from 'npm:png-chunks-encode'
import extractPng from 'npm:png-chunks-extract'

import dataReader from 'fount/public/parts/ImportHandlers/SillyTavern/data_reader.mjs'
import { PROMPT_MARKER } from 'fount/scripts/test/fixtures/mock_ai.mjs'

/** 用作头像 / 卡片载体的 1×1 PNG。 */
export const MINIMAL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * 构造 SillyTavern v2 `data` 对象。
 * @param {object} [overrides] field overrides
 * @returns {object} ST v2 char data
 */
export function buildStV2Data(overrides = {}) {
	return {
		name: 'STImportTest',
		description: `${PROMPT_MARKER} ST description for prompt build.`,
		personality: 'curious tester',
		scenario: 'importer integration test',
		first_mes: 'Hello {{user}}, I am {{char}}.',
		mes_example: '',
		creator_notes: 'fount importer test card',
		system_prompt: '',
		post_history_instructions: '',
		alternate_greetings: ['Alt greeting from {{char}}.'],
		tags: ['test', 'importer'],
		creator: 'fount-test',
		character_version: '1.0.0',
		extensions: {
			talkativeness: 0.5,
		},
		...overrides,
	}
}

/**
 * 构造 SillyTavern PNG 角色卡缓冲（`chara` 块）。
 * @param {object} [overrides] ST v2 field overrides
 * @returns {Buffer} PNG with embedded card
 */
export function buildStPngCard(overrides = {}) {
	return dataReader.write(MINIMAL_PNG, JSON.stringify({
		spec: 'chara_card_v2',
		spec_version: '2.0',
		data: buildStV2Data(overrides),
	}))
}

/**
 * 构造 Risu CCv3 角色卡对象。
 * @param {object} [overrides] `data` field overrides
 * @returns {object} CCv3 card
 */
export function buildCCv3Card(overrides = {}) {
	return {
		spec: 'chara_card_v3',
		spec_version: '3.0',
		data: {
			name: 'RisuImportTest',
			description: `${PROMPT_MARKER} Risu CCv3 description for prompt build.`,
			personality: 'helpful tester',
			scenario: 'risu importer integration test',
			first_mes: 'Greetings {{user}}, this is {{char}} from Risu.',
			mes_example: '',
			creator_notes: 'fount risu importer test card',
			system_prompt: '',
			post_history_instructions: '',
			alternate_greetings: [],
			tags: ['test', 'risu'],
			creator: 'fount-test',
			character_version: '1.0.0',
			extensions: {},
			...overrides,
		},
	}
}

/**
 * 构造供 Risu ImportAsData 使用的裸 CCv3 JSON 缓冲。
 * @param {object} [overrides] `data` field overrides
 * @returns {Buffer} UTF-8 JSON buffer
 */
export function buildCCv3JsonBuffer(overrides = {}) {
	return Buffer.from(JSON.stringify(buildCCv3Card(overrides)), 'utf8')
}

/**
 * 构造带 `ccv3` tEXt 块的 PNG，供 Risu ImportAsData 使用。
 * @param {object} [overrides] `data` field overrides
 * @returns {Buffer} PNG with CCv3 metadata
 */
export function buildCCv3PngCard(overrides = {}) {
	const chunks = extractPng(MINIMAL_PNG)
	chunks.splice(
		chunks.findIndex(chunk => chunk.name === 'IEND'),
		0,
		encodeText('ccv3', Buffer.from(JSON.stringify(buildCCv3Card(overrides)), 'utf8').toString('base64')),
	)
	return Buffer.from(encodePng(chunks))
}
