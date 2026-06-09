import { importFiles } from '../src/endpoints.mjs'

/**
 * 安装 shell 的文件拖放处理器。
 * 接收用户拖入的文件并触发安装流程。
 * @param {DataTransfer} dataTransfer 拖放事件中的 DataTransfer 对象。
 * @param {object} handlerConfig 此处理器的配置。
 * @returns {Promise<boolean>} 已处理返回 true，否则返回 false。
 */
export default async function (dataTransfer, handlerConfig) {
	if (!dataTransfer.files?.length) return false

	const formData = new FormData()
	for (let i = 0; i < dataTransfer.files.length; i++)
		formData.append('files', dataTransfer.files[i])

	const response = await importFiles(formData)
	return response.ok
}
