import { getLocalizedInfo } from '../../scripts/locale.mjs'

/**
 * 递归地本地化一个项目数组及其所有子项目。
 * @param {Array<object>} items - 要递归本地化的项目数组。
 * @param {Array<string>} locales - 用户的语言环境列表。
 * @returns {Array<object>} 递归本地化后的项目数组。
 */
function localizeRecursively(items, locales) {
	if (!items) return []
	return items.map(item => ({
		...item,
		info: getLocalizedInfo(item.info, locales),
		sub_items: localizeRecursively(item.sub_items, locales)
	}))
}

/**
 * 合并具有相同ID的按钮，并递归地合并它们的子项目。
 * @param {Array<object>} buttonList - 要合并的按钮列表。
 * @returns {Array<object>} 合并后的按钮列表。
 */
function mergeButtons(buttonList) {
	if (!buttonList) return []
	const buttonsById = new Map()
	const otherButtons = []

	for (const button of buttonList) if (button.id) {
		if (!buttonsById.has(button.id))
			buttonsById.set(button.id, [])
		buttonsById.get(button.id).push(button)
	} else
		otherButtons.push(button)

	const mergedList = []
	for (const [id, buttonsToMerge] of buttonsById.entries()) {
		const baseButton = JSON.parse(JSON.stringify(buttonsToMerge[0]))
		let allSubItems = baseButton.sub_items || []

		for (let i = 1; i < buttonsToMerge.length; i++) {
			const nextButton = buttonsToMerge[i]
			Object.assign(baseButton.info, nextButton.info)
			Object.assign(baseButton, {
				level: nextButton.level ?? baseButton.level,
				button: nextButton.button ?? baseButton.button,
				classes: nextButton.classes ?? baseButton.classes,
				style: nextButton.style ?? baseButton.style,
				action: nextButton.action ?? baseButton.action,
				url: nextButton.url ?? baseButton.url,
			})
			if (nextButton.sub_items)
				allSubItems = allSubItems.concat(nextButton.sub_items)
		}

		if (allSubItems.length)
			baseButton.sub_items = mergeButtons(allSubItems)

		mergedList.push(baseButton)
	}

	return [...mergedList, ...otherButtons]
}

/**
 * 预处理按钮列表：本地化、合并和排序。
 * @param {object} list - 按钮列表。
 * @param {Array<string>} locales - 用户的语言环境列表。
 * @returns {Array<object>} 预处理后的按钮列表。
 */
export function processButtonList(list, locales) {
	const allButtons = localizeRecursively(Object.values(list).flat(), locales)
	const finalButtons = mergeButtons(allButtons)
	finalButtons.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
	return finalButtons
}
