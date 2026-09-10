/**
 * gist shell 的 Markdown 拖入处理器：读取拖入的 .md/.markdown 文件，
 * 以高安全等级创建 gist 文档并跳转查看页面；
 * 若已有内容一致的 gist（后端按内容哈希去重）则直接打开该 gist，不重复创建。
 */
import { createGist } from '../src/endpoints.mjs'

/**
 * 判断文件是否为 Markdown 文件
 * @param {File} file 待判断文件
 * @returns {boolean} 是否为 .md/.markdown
 */
function isMarkdownFile(file) {
	return /\.(md|markdown)$/i.test(file.name || '')
}

/**
 * 拖入文件为 Markdown 文件则存成 md 文件以高安全等级的 gist 文档并跳转查看页面
 * @param {DataTransfer} dataTransfer 拖放事件中的 DataTransfer 对象
 * @param {object} handlerConfig 此处理器的配置。
 * @returns {Promise<boolean>} 已处理返回 true，否则返回 false
 */
export default async function (dataTransfer, handlerConfig) {
	const file = [...dataTransfer.files || []].find(isMarkdownFile)
	if (!file) return false

	const markdown = await file.text()
	const { id } = await createGist({
		markdown,
		title: file.name.replace(/\.(md|markdown)$/i, ''),
		securityLevel: 'secure',
		source: { type: 'md-drop', ref: { name: file.name }, exportedAt: Date.now() },
		dedupe: true,
	})
	location.href = `/parts/shells:gist/view?id=${encodeURIComponent(id)}`
	return true
}
