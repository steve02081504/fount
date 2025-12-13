/**
 * 'x-fount-part' 数据类型的拖出生成器。
 * 生成包含部件类型和部件名称的字符串。
 * @param {string} parttype - 被拖动项的类型。
 * @param {string} partname - 被拖动项的名称。
 * @param {object} partdetails - 被拖动项的详细信息。
 * @param {object} generatorConfig - 此生成器的配置。
 * @returns {string} 生成的拖出数据。
 */
export default function (parttype, partname, partdetails, generatorConfig) {
	return `${parttype}/${partname}`
}
