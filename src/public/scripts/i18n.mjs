let i18n = {}
let saved_pageid

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid]
 */
export async function initTranslations(pageid = saved_pageid) {
	saved_pageid = pageid

	try {
		const response = await fetch('/api/getlocaledata')
		if (!response.ok)
			throw new Error(`Failed to fetch translations: ${response.status} ${response.statusText}`)

		i18n = await response.json()
		applyTranslations()
	} catch (error) {
		console.error('Error initializing translations:', error)
	}
}

function getNestedValue(obj, key) {
	const keys = key.split('.')
	let value = obj
	for (const k of keys)
		if (value && typeof value === 'object' && k in value)
			value = value[k]
		else
			return undefined

	return value
}
/**
 * 根据提供的键（key）获取翻译后的文本。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本，如果未找到则返回键本身。
 */
export function geti18n(key, params = {}) {
	let translation = getNestedValue(i18n, key)

	if (translation === undefined)
		console.warn(`Translation key "${key}" not found.`)

	// 简单的插值处理
	for (const param in params)
		translation = translation.replaceAll(`\${${param}}`, params[param])

	return translation
}


/**
 * 将翻译应用到 DOM 元素。
 * @private
 */
function applyTranslations() {
	// 翻译 <title> 标签
	document.title = geti18n(`${saved_pageid}.title`)

	const descriptionMeta = document.querySelector('meta[name="description"]')
	if (descriptionMeta)
		descriptionMeta.content = geti18n(`${saved_pageid}.description`)
	document.documentElement.lang = geti18n('lang')

	i18nElement(document)
}

export function i18nElement(element) {
	const elements = element.querySelectorAll('[data-i18n]')
	elements.forEach((element) => {
		const key = element.dataset.i18n
		if (!key) return
		if (getNestedValue(i18n, key) instanceof Object) {
			const attributes = ['placeholder', 'title', 'label', 'text', 'value', 'alt']

			for (const attr of attributes) {
				const specificKey = `${key}.${attr}`
				const translation = geti18n(specificKey)
				if (!translation) continue
				if (attr === 'text')
					element.textContent = translation
				else
					element[attr] = translation
			}
		}
		else
			element.textContent = geti18n(key)
	})
	return element
}

window.addEventListener('languagechange', () => {
	initTranslations()
})
