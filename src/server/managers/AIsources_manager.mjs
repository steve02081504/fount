// 旧版本兼容文件
const funcs = await import('./AIsource_manager.mjs')
const warnText = `
=========================================================================
!!!You are using a deprecated file and this file will be removed in few days!!!
!!!use \`AIsource_manager.mjs\` instead.!!!
=========================================================================
`

/**
 * @deprecated
 */
export function loadAIsourceGenerator(...args) {
	console.warn(warnText)
	console.trace()
	const { loadAIsourceGenerator } = funcs
	return loadAIsourceGenerator(...args)
}

/**
 * @deprecated
 */
export function unloadAIsourceGenerator(...args) {
	console.warn(warnText)
	console.trace()
	const { unloadAIsourceGenerator } = funcs
	return unloadAIsourceGenerator(...args)
}

/**
 * @deprecated
 */
export function loadAIsourceFromConfigData(...args) {
	console.warn(warnText)
	console.trace()
	const { loadAIsourceFromConfigData } = funcs
	return loadAIsourceFromConfigData(...args)
}

/**
 * @deprecated
 */
export function loadAIsource(...args) {
	console.warn(warnText)
	console.trace()
	const { loadAIsource } = funcs
	return loadAIsource(...args)
}

/**
 * @deprecated
 */
export function loadAIsourceFromNameOrConfigData(...args) {
	console.warn(warnText)
	console.trace()
	const { loadAIsourceFromNameOrConfigData } = funcs
	return loadAIsourceFromNameOrConfigData(...args)
}

/**
 * @deprecated
 */
export function unloadAIsource(...args) {
	console.warn(warnText)
	console.trace()
	const { unloadAIsource } = funcs
	return unloadAIsource(...args)
}

/**
 * @deprecated
 */
export function isAIsourceLoaded(...args) {
	console.warn(warnText)
	console.trace()
	const { isAIsourceLoaded } = funcs
	return isAIsourceLoaded(...args)
}

/**
 * @deprecated
 */
export function reloadAIsource(...args) {
	console.warn(warnText)
	console.trace()
	const { reloadAIsource } = funcs
	return reloadAIsource(...args)
}
