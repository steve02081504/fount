/**
 * 测试用 mock 语音识别源：直接导出可 Recognize 的实例。
 */
import generator from '../../../../../../public/parts/serviceGenerators/SpeechRecognition/mock/main.mjs'

const source = await generator.interfaces.serviceGenerator.GetSource({
	name: 'mock-text',
	text: '这是一段用于测试的假流式识别文字。',
	chunk_delay_ms: 0,
	chunk_size: 1,
})

/**
 * mock 语音识别服务源。
 */
export default {
	...source,
	filename: 'mock_text',
	/**
	 * @returns {void}
	 */
	Load() { },
	interfaces: {
		config: {
			/**
			 * @returns {object} 空配置
			 */
			GetData: () => ({}),
			/**
			 * @returns {Promise<void>}
			 */
			SetData: async () => { },
		},
	},
}
