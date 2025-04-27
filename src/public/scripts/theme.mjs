import { svgInliner } from './svg-inliner.mjs'
import { initLinesBackground, updateColors as updateLinesBackgroundColors } from './lines_background.mjs'

let theme_now
export let is_dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)

let oldBcColor
function check_color_change() {
	const computedStyle = getComputedStyle(document.documentElement)
	const bcColor = computedStyle.getPropertyValue('background-color').trim()
	if (oldBcColor !== bcColor) {
		updateColors()
		oldBcColor = bcColor
	}
}
function autoresize_frames() {
	const frames = document.querySelectorAll('iframe')
	for (const frame of frames) if (frame.contentWindow.document.body) {
		const frame_width = frame.contentWindow.document.body.scrollWidth
		const frame_height = frame.contentWindow.document.body.scrollHeight
		frame.style.width = frame_width + 'px'
		frame.style.height = frame_height + 'px'
	}
}
function themeHeartbeat() {
	autoresize_frames()
	check_color_change()
}

export const applyTheme = () => {
	initLinesBackground()
	setTheme(localStorage.getItem('theme'))
	svgInliner(document)
	setInterval(themeHeartbeat, 1000)
}

const functions = []

export function onThemeChange(callback) {
	callback(theme_now, is_dark)
	functions.push(callback)
}

export function getCurrentTheme() {
	return theme_now
}

export function setTheme(theme) {
	if (theme === theme_now) return
	theme_now = theme
	localStorage.setItem('theme', theme || '')
	theme ||= Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
	if (document.documentElement.dataset.theme !== theme) document.documentElement.setAttribute('data-theme', theme)
}
function updateColors() {
	// Use getComputedStyle to get the *computed* value of background-color, which resolves var(--bc)
	const computedStyle = getComputedStyle(document.documentElement)
	const bcColor = computedStyle.getPropertyValue('background-color').trim()

	if (bcColor) {
		// Corrected regex to handle oklch, rgb, rgba, hsl, hsla, and named colors
		const oklchRegex = /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*\)/
		const rgbRegex = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/
		const rgbaRegex = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
		const hslRegex = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)\s*\)/
		const hslaRegex = /hsla\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)\s*,\s*([\d.]+)\s*\)/

		let lightness

		if (oklchRegex.test(bcColor)) {
			const match = bcColor.match(oklchRegex)
			lightness = parseFloat(match[1])
			if (!match[1].endsWith('%'))
				lightness *= 100 // Convert 0-1 to percentage

		} else if (rgbRegex.test(bcColor) || rgbaRegex.test(bcColor)) {
			const match = bcColor.match(rgbRegex) || bcColor.match(rgbaRegex)
			const r = parseInt(match[1], 10)
			const g = parseInt(match[2], 10)
			const b = parseInt(match[3], 10)
			// Convert RGB to relative luminance (perceived brightness)
			// See: https://www.w3.org/TR/WCAG20/#relativeluminancedef
			const a = [r, g, b].map(v => {
				v /= 255
				return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
			})
			lightness = (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) * 100

		} else if (hslRegex.test(bcColor) || hslaRegex.test(bcColor)) {
			const match = bcColor.match(hslRegex) || bcColor.match(hslaRegex)
			lightness = parseFloat(match[3]) //L in HSL is the lightness.
			if (!match[3].endsWith('%'))
				lightness *= 100

		} else {
			// Handle named colors (e.g., "red", "blue") and other formats.  Difficult without a lookup table.
			//  Best to use a default or signal an error.
			console.warn('Unsupported color format:', bcColor)
			lightness = 50 // Default to a neutral lightness
		}
		// 2. Set a Threshold (adjust as needed)
		const threshold = 55  //  55% lightness

		// 3. Determine is_dark
		is_dark = lightness < threshold

	} else {
		console.warn('The --bc variable or background-color is not defined on documentElement.')
		// Fallback: Use system preference if --bc is not found.
		is_dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
	}

	document.documentElement.setAttribute('data-theme-isdark', is_dark)

	updateLinesBackgroundColors()
	for (const func of functions)
		func(theme_now, is_dark)
}

// MutationObserver用于监视data-theme属性的变化
const observer = new MutationObserver((mutationsList) => {
	for (const mutation of mutationsList)
		if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme')
			setTimeout(themeHeartbeat)
})
observer.observe(document.documentElement, { attributes: true })

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
	setTheme(localStorage.getItem('theme') || (e.matches ? 'dark' : 'light'))
})
// 重新获取焦点时应用当前主题
window.addEventListener('focus', () => {
	setTheme(localStorage.getItem('theme'))
})
{
	const daisyui_theme_style = document.createElement('link')
	daisyui_theme_style.rel = 'stylesheet'
	daisyui_theme_style.href = 'https://cdn.jsdelivr.net/npm/daisyui/themes.css'
	document.head.prepend(daisyui_theme_style)
}
export const builtin_themes = [
	'light',
	'dark',
	'cupcake',
	'bumblebee',
	'emerald',
	'corporate',
	'synthwave',
	'retro',
	'cyberpunk',
	'valentine',
	'halloween',
	'garden',
	'forest',
	'aqua',
	'lofi',
	'pastel',
	'fantasy',
	'wireframe',
	'black',
	'luxury',
	'dracula',
	'cmyk',
	'autumn',
	'business',
	'acid',
	'lemonade',
	'night',
	'coffee',
	'winter',
	'dim',
	'nord',
	'sunset',
	'caramellatte',
	'abyss',
	'silk'
]
