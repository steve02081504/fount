/**
 * @param {string} parttype - 部件类型 (例如 'chars', 'worlds')
 * @param {string} partname - 部件名称
 * @param {object} partdetails - 部件详情
 * @param {object} generatorConfig - 生成器配置
 * @returns {string} - 下载 URL
 */
export default async function (parttype, partname, partdetails, generatorConfig) {
	const downloadUrl = `/virtual_files/shells/export/download/${parttype}/${partname}?withData=true`
	return `application/octet-stream:${partname}:${window.location.origin}${downloadUrl}`
}
