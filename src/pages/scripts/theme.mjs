import { svgInliner } from './svgInliner.mjs'
import { initLinesBackground, updateColors as updateLinesBackgroundColors } from './linesBackground.mjs'

function parseOklch(colorString) {
	const oklchRegex = /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*\)/;
	if (oklchRegex.test(colorString)) {
		const match = colorString.match(oklchRegex);
		let lightness = parseFloat(match[1]);
		if (!match[1].endsWith('%')) {
			lightness *= 100; // Convert 0-1 to percentage
		}
		return lightness;
	}
	return null;
}

function parseRgb(colorString) {
	const rgbRegex = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/;
	const rgbaRegex = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/;
	if (rgbRegex.test(colorString) || rgbaRegex.test(colorString)) {
		const match = colorString.match(rgbRegex) || colorString.match(rgbaRegex);
		const r = parseInt(match[1], 10);
		const g = parseInt(match[2], 10);
		const b = parseInt(match[3], 10);
		const a = [r, g, b].map(v => {
			v /= 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
		});
		return (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) * 100;
	}
	return null;
}

function parseHsl(colorString) {
	const hslRegex = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)\s*\)/;
	const hslaRegex = /hsla\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)\s*,\s*([\d.]+)\s*\)/;
	if (hslRegex.test(colorString) || hslaRegex.test(colorString)) {
		const match = colorString.match(hslRegex) || colorString.match(hslaRegex);
		let lightness = parseFloat(match[3]); // L in HSL is the lightness.
		if (!match[3].endsWith('%')) {
			lightness *= 100; // Convert non-% to percentage
		}
		return lightness;
	}
	return null;
}

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
	for (const frame of frames) try {
		if (frame.contentWindow?.document?.body) {
			const frame_width = frame.contentWindow.document.body.scrollWidth
			const frame_height = frame.contentWindow.document.body.scrollHeight
			frame.style.width = frame_width + 'px'
			frame.style.height = frame_height + 'px'
		}
	} catch (e) { }
}
function themeHeartbeat() {
	setTheme(localStorage.getItem('theme'))
	autoresize_frames()
	check_color_change()
}

export const applyTheme = () => {
	setTheme(localStorage.getItem('theme'))
	svgInliner(document)
	setTimeout(initLinesBackground, 750)
	setInterval(themeHeartbeat, 1000)
}

const functions = []

export function onThemeChange(callback) {
	try {
		callback(theme_now, is_dark)
	}
	catch (e) {
		console.error(e)
	}
	functions.push(callback)
}

export function getCurrentTheme() {
	return theme_now
}

export function setTheme(theme) {
	if (theme === theme_now) return
	theme_now = theme
	localStorage.setItem('theme', theme)
	if (theme === 'auto') theme = null
	theme ||= (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
	if (document.documentElement.dataset.theme !== theme) document.documentElement.setAttribute('data-theme', theme)
}
function updateColors() {
	// Use getComputedStyle to get the *computed* value of background-color, which resolves var(--bc)
	const computedStyle = getComputedStyle(document.documentElement)
	const bcColor = computedStyle.getPropertyValue('background-color').trim()
	let lightness = null;

	if (bcColor) {
		lightness = parseOklch(bcColor);
		if (lightness === null) {
			lightness = parseRgb(bcColor);
		}
		if (lightness === null) {
			lightness = parseHsl(bcColor);
		}

		if (lightness !== null) {
			const threshold = 55;  //  55% lightness
			is_dark = lightness < threshold;
		} else {
			// Handle named colors (e.g., "red", "blue") and other formats.
			console.warn('Unsupported color format:', bcColor);
			// Fallback: Use system preference for unsupported formats
			is_dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		}
	} else {
		console.warn('The --bc variable or background-color is not defined on documentElement.');
		// Fallback: Use system preference if --bc is not found.
		is_dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	document.documentElement.setAttribute('color-scheme', is_dark ? 'dark' : 'light')

	updateLinesBackgroundColors()
	for (const func of functions) try {
		func(theme_now, is_dark)
	}
	catch (e) {
		console.error(e)
	}
}

// MutationObserver用于监视data-theme属性的变化
const observer = new MutationObserver((mutationsList) => {
	for (const mutation of mutationsList)
		if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme')
			setTimeout(themeHeartbeat)
})
observer.observe(document.documentElement, { attributes: true })

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
	setTheme(localStorage.getItem('theme'))
})
{
	const daisyui_theme_style = document.createElement('link')
	daisyui_theme_style.rel = 'stylesheet'
	daisyui_theme_style.href = 'https://cdn.jsdelivr.net/npm/daisyui/themes.css'
	daisyui_theme_style.crossorigin = 'anonymous'
	document.head.prepend(daisyui_theme_style)
}
export const builtin_themes = await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js').then(m => m.default)
