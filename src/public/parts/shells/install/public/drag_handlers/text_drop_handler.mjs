import { importText } from '../src/endpoints.mjs'

/**
 * 安装 shell 的文本拖放处理器。
 * 接收用户拖入的纯文本并触发安装流程。
 * @param {DataTransfer} dataTransfer 拖放事件中的 DataTransfer 对象。
 * @param {object} handlerConfig 此处理器的配置。
 * @returns {Promise<boolean>} 已处理返回 true，否则返回 false。
 */
export default async function (dataTransfer, handlerConfig) {
	const text = dataTransfer.getData('text/plain')
	if (!text) return false
	const response = await importText(text)
	return response.ok
}
