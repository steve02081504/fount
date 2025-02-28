import { svgInliner } from './svg-inliner.mjs'

export let is_dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
export const applyTheme = () => {
	document.documentElement.setAttribute('data-theme', is_dark ? 'dark' : 'light')
	svgInliner(document)
	return is_dark
}
const functions = []
export function onThemeChange(callback) {
	callback(is_dark)
	functions.push(callback)
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
	is_dark = e.matches
	for (const func of functions) func(is_dark)
})
