/**
 * 集成测试用：proxy 生成器 + FOUNT_TEST_OPENAI_MOCK_URL 指向的 OpenAI mock。
 */
import process from 'node:process'

import generator from 'fount/public/parts/serviceGenerators/AI/proxy/main.mjs'

const url = process.env.FOUNT_TEST_OPENAI_MOCK_URL
if (!url) throw new Error('FOUNT_TEST_OPENAI_MOCK_URL is required for proxy_openai_mock')

const source = await generator.interfaces.serviceGenerator.GetSource({
	name: 'proxy_openai_mock',
	url,
	model: 'mock-cache',
	apikey: 'test-key',
	use_stream: false,
	model_arguments: {
		temperature: 0,
		n: 1,
		logprobs: false,
	},
	convert_config: {
		roleReminding: true,
		ignoreFiles: true,
		forceRoleAlternation: false,
		forceUserMessageEnding: false,
		forceNoSystemMessages: false,
	},
}, {
	/**
	 * @returns {void}
	 */
	SaveConfig: () => { },
})

source.filename = 'proxy_openai_mock'

export default source
