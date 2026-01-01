/**
 * 'x-fount-part' 数据类型的拖出生成器。
 * 生成包含部件路径的字符串。
 * @param {string} partpath - 被拖动项的路径（例如 'chars/GentianAphrodite'）。
 * @param {object} partdetails - 被拖动项的详细信息。
 * @param {object} generatorConfig - 此生成器的配置。
 * @returns {string} 生成的拖出数据。
 */
export default function (partpath, partdetails, generatorConfig) {
	const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
	return normalizedPartpath
}
