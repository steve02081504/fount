/**
 * @param {string} partpath - 部件路径 (例如 'chars/my-char', 'worlds/my-world')
 * @param {object} partdetails - 部件详情
 * @param {object} generatorConfig - 生成器配置
 * @returns {string} - 下载 URL
 */
export default function (partpath, partdetails, generatorConfig) {
	const partname = partpath.split('/').pop()
	const downloadUrl = `/virtual_files/parts/shells:export/download/${partpath}?withData=true`
	return `application/octet-stream:${partname}:${window.location.origin}${downloadUrl}`
}
