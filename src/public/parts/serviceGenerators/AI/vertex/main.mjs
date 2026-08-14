import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { GetSource as geminiGetSource } from '../gemini/main.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Vertex AI 配置模板。
 */
const configTemplate = {
	name: 'Google Vertex AI',
	model: process.env.VERTEX_MODEL || 'gemini-2.5-flash',
	project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
	location: process.env.VERTEX_LOCATION || 'us-central1',
	model_arguments: {
		responseMimeType: 'text/plain',
		responseModalities: ['Text'],
	},
	use_stream: true,
}

/**
 * Google Vertex AI 生成器（ADC，不塞进 gemini apikey 模板）。
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 配置页：缺 project/location 时提示。
			 * @returns {Promise<{ js: string }>} 脚本。
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8'),
			}),
			/**
			 * 默认配置。
			 * @returns {Promise<object>} 模板。
			 */
			GetConfigTemplate: async () => structuredClone(configTemplate),
			GetSource,
		},
	},
}

/**
 * 创建 Vertex AI 源。
 * @param {object} config - 配置。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config) {
	return geminiGetSource(config, {
		product_info,
		/**
		 * 用 ADC 构造 Vertex 客户端。
		 * @param {{ GoogleGenAI: new (opts: object) => any }} args - SDK。
		 * @returns {any} 客户端。
		 */
		createAi: ({ GoogleGenAI }) => new GoogleGenAI({
			vertexai: true,
			project: config.project,
			location: config.location,
		}),
	})
}
