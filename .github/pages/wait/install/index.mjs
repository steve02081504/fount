import { animateSVG } from 'https://cdn.jsdelivr.net/gh/steve02081504/animate-SVG/index.mjs'
import * as Sentry from 'https://esm.run/@sentry/browser'

import { setBaseDir, setPreRender, setTheme, theme_now } from '../../base.mjs'
import { isFountServiceAvailable, saveFountHostUrl, getFountHostUrl, pingFount } from '../../scripts/fountHostGetter.mjs'
import { initTranslations, geti18n, console, getAvailableLocales, getLocaleNames, setLocales } from '../../scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { showToast } from '../../scripts/toast.mjs'

setBaseDir('../..')
usingTemplates('wait/install/templates')
const hostUrl = 'http://localhost:8931'

// --- DOM Element Selection ---
const launchButton = document.getElementById('launchButton')
const launchButtonText = document.getElementById('launchButtonText')
const launchButtonSpinner = document.getElementById('launchButtonSpinner')
const footer = document.querySelector('.footer')
const footerReadyText = document.getElementById('footerReadyText')
const themeList = document.getElementById('theme-list')
const activeUsersCountEl = document.getElementById('active-users-count')
const starsCountEl = document.getElementById('stars-count')

// --- Helper Functions ---
const fetchJson = async (url, fallback = null) => {
	try {
		const response = await fetch(url)
		if (!response.ok) return fallback
		return await response.json()
	}
	catch (error) {
		console.error(`Failed to fetch JSON from ${url}:`, error)
		return fallback
	}
}

// --- Initial Data Fetching ---
const [initialUserData, initialRepoData] = await Promise.all([
	fetchJson('https://data.jsdelivr.com/v1/stats/packages/gh/steve02081504/fount?period=year'),
	fetchJson('https://api.github.com/repos/steve02081504/fount')
])
const activeUserNum = initialUserData?.hits?.total ?? NaN
const starNum = initialRepoData?.stargazers_count ?? NaN

// --- Hero Intro Animation ---
async function playHeroAnimation() {
	const heroElement = document.querySelector('.hero')
	const animationContainer = document.getElementById('hero-animation-bg')
	const heroOverlay = document.querySelector('.hero-overlay')
	const heroContent = document.querySelector('.hero-content')

	const showFinalState = () => {
		heroOverlay.classList.add('visible-after-intro')
		heroContent.classList.add('visible-after-intro')
		heroElement.classList.add('bg-image-loaded')
		if (animationContainer) animationContainer.remove()
		document.body.classList.remove('scroll-lock')
	}

	try {
		document.body.classList.add('scroll-lock')
		const svgText = await fetch('https://steve02081504.github.io/fount/imgs/repo-img.svg').then(res => {
			if (!res.ok) throw new Error(`Failed to load SVG: ${res.statusText}`)
			return res.text()
		})

		const svgElement = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement
		svgElement.setAttribute('preserveAspectRatio', 'xMidYMid slice')
		animationContainer.appendChild(svgElement)

		animateSVG(svgElement)
		const durationMs = 3100

		setTimeout(() => {
			showFinalState()
			animationContainer.style.opacity = '0'
			animationContainer.addEventListener('transitionend', () => animationContainer.remove(), { once: true })
		}, durationMs)
	}
	catch (error) {
		console.error('Hero animation failed:', error)
		showFinalState()
	}
}

// --- Theme Selection ---
async function createAutoPreview() {
	const container = document.createElement('div')
	container.className = 'theme-preview-card cursor-pointer auto-theme-container'

	const [darkHalf, lightHalf] = await Promise.all([
		renderTemplate('theme_preview', { theme: 'dark', name: 'auto' }),
		renderTemplate('theme_preview', { theme: 'light', name: 'auto' })
	])

	darkHalf.className = 'auto-theme-half auto-theme-dark'
	lightHalf.className = 'auto-theme-half auto-theme-light'

	container.append(lightHalf, darkHalf)
	return container
}

async function renderThemePreviews() {
	themeList.innerHTML = ''
	const themes = await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js').then(m => m.default)

	const autoPreview = await createAutoPreview()
	autoPreview.addEventListener('click', () => handleThemeClick(autoPreview, 'auto'))
	if (!theme_now) autoPreview.classList.add('selected-theme')
	themeList.appendChild(autoPreview)

	const previewPromises = themes.map(async (theme) => {
		const preview = await renderTemplate('theme_preview', { theme })
		if (!preview) {
			console.error(`Failed to render preview for theme: ${theme}`)
			return null
		}
		preview.addEventListener('click', () => handleThemeClick(preview, theme))
		if (theme_now === theme) preview.classList.add('selected-theme')
		return preview
	})

	const renderedPreviews = (await Promise.all(previewPromises)).filter(Boolean)
	themeList.append(...renderedPreviews)
}

function handleThemeClick(previewElement, theme) {
	const applyNewTheme = () => {
		setTheme(theme)
		document.querySelectorAll('.theme-preview-card.selected-theme').forEach(el => el.classList.remove('selected-theme'))
		previewElement.classList.add('selected-theme')
	}

	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	if (!document.startViewTransition || prefersReducedMotion)
		applyNewTheme()
	else
		document.startViewTransition(applyNewTheme)
}

// --- Data Showcase Animation ---
function animateCounter(element, start, end, duration, easingPower = 5) {
	return new Promise(resolve => {
		if (start === end) {
			element.textContent = end.toLocaleString()
			return resolve()
		}
		let startTime = null
		const step = (timestamp) => {
			if (!startTime) startTime = timestamp
			const progress = Math.min((timestamp - startTime) / duration, 1)
			const easedProgress = 1 - (1 - progress) ** easingPower
			const currentValue = Math.floor(start + (end - start) * easedProgress)
			element.textContent = currentValue.toLocaleString()

			if (progress < 1)
				window.requestAnimationFrame(step)
			else {
				element.textContent = end.toLocaleString()
				resolve()
			}
		}
		window.requestAnimationFrame(step)
	})
}

async function startDataShowcaseAnimation() {
	const LONG_ANIMATION_DURATION = 5 * 60 * 1000 // 5 minutes
	const SHORT_ANIMATION_DURATION = 3000 // 3 seconds

	const initialAnimations = []
	if (!isNaN(activeUserNum))
		initialAnimations.push(animateCounter(activeUsersCountEl, 0.8 * activeUserNum, activeUserNum, LONG_ANIMATION_DURATION))
	else
		activeUsersCountEl.textContent = '?'


	if (!isNaN(starNum))
		initialAnimations.push(animateCounter(starsCountEl, 0.8 * starNum, starNum, LONG_ANIMATION_DURATION))
	else
		starsCountEl.textContent = '?'


	await Promise.all(initialAnimations)
	console.log('Initial number animation complete. Starting periodic updates.')

	setInterval(async () => {
		const [userData, repoData] = await Promise.all([
			fetchJson('https://data.jsdelivr.com/v1/stats/packages/gh/steve02081504/fount?period=year'),
			fetchJson('https://api.github.com/repos/steve02081504/fount')
		])

		const newActiveUserNum = userData?.hits?.total ?? NaN
		const newStarNum = repoData?.stargazers_count ?? NaN

		const updateStat = (element, newValue, shortDuration) => {
			const currentDisplayed = parseInt(element.textContent.replace(/,/g, ''), 10)
			if (!isNaN(newValue) && newValue !== currentDisplayed) {
				console.log(`Updating stat from ${currentDisplayed} to ${newValue}`)
				animateCounter(element, isNaN(currentDisplayed) ? 0 : currentDisplayed, newValue, shortDuration, 3)
			}
		}

		updateStat(activeUsersCountEl, newActiveUserNum, SHORT_ANIMATION_DURATION)
		updateStat(starsCountEl, newStarNum, SHORT_ANIMATION_DURATION)
	}, 60 * 1000)
}

function createRotatingText(container, initialWords, interval) {
	let words = initialWords
	let currentIndex = 0
	let intervalId = null
	let spans = []

	const setup = () => {
		container.innerHTML = ''
		spans = words.map(word => {
			const span = document.createElement('span')
			span.textContent = word
			container.appendChild(span)
			return span
		})
	}

	const updateDisplay = () => {
		spans.forEach(span => span.classList.remove('active', 'exiting'))
		const currentSpan = spans[currentIndex]
		if (currentSpan) {
			currentSpan.classList.add('active')
			requestAnimationFrame(() => container.style.width = `${currentSpan.offsetWidth}px`)
		}
		else
			container.style.width = '0px'
	}

	const rotate = () => {
		if (words.length < 2) return
		const nextIndex = Math.floor(Math.random() * words.length)

		if (nextIndex == currentIndex) return

		const currentSpan = spans[currentIndex]
		const nextSpan = spans[nextIndex]

		if (!currentSpan || !nextSpan) return stop()

		container.style.width = `${nextSpan.offsetWidth}px`
		currentSpan.classList.remove('active')
		currentSpan.classList.add('exiting')
		nextSpan.classList.add('active')
		setTimeout(() => currentSpan.classList.remove('exiting'), 500)
		currentIndex = nextIndex
	}

	const start = () => {
		if (!intervalId && words.length >= 2) intervalId = setInterval(rotate, interval)
	}
	const stop = () => {
		if (intervalId) clearInterval(intervalId)
		intervalId = null
	}

	setup()
	updateDisplay()
	start()

	return {
		updateWords: (newWords) => {
			words = newWords
			setup()
			currentIndex %= words.length
			updateDisplay()
			stop()
			start()
		},
		stop,
		start
	}
}

let adjectiveRotator, nounRotator, platformRotator

function updateRotatingSubtitles() {
	adjectiveRotator?.updateWords(geti18n('installer_wait_screen.data_showcase.adjectives') || [])
	nounRotator?.updateWords(geti18n('installer_wait_screen.data_showcase.nouns') || [])
	platformRotator?.updateWords(geti18n('installer_wait_screen.data_showcase.platforms') || [])
}

// --- Language Selector ---
function populateLanguageSelector() {
	const languageSelector = document.getElementById('language-selector')
	if (!languageSelector) return

	languageSelector.innerHTML = '' // Clear existing items
	const locales = getAvailableLocales()
	const localeNames = getLocaleNames()

	const items = locales.map(locale => {
		const li = document.createElement('li')
		const a = document.createElement('a')
		a.textContent = localeNames.get(locale) || locale
		a.onclick = async (e) => {
			e.preventDefault()
			await setLocales([locale])
			updateRotatingSubtitles()
			document.activeElement?.blur()
		}
		li.appendChild(a)
		return li
	})

	languageSelector.append(...items)
}

// --- Fount Service Connection Logic ---
const checkFountInstallerAlive = async () => {
	try {
		return (await fetch('http://localhost:8930')).ok
	}
	catch {
		return false
	}
}

async function handleInstallerFlow() {
	document.getElementById('theme-selection-section').style.display = 'block'
	document.getElementById('mini-game-section').style.display = 'block'
	footerReadyText.textContent = geti18n('installer_wait_screen.footer.wait_text')

	const timer = setInterval(async () => {
		if (!await checkFountInstallerAlive()) {
			clearInterval(timer)
			window.location.href = './error'
			return
		}

		if (await isFountServiceAvailable(hostUrl)) {
			clearInterval(timer)
			saveFountHostUrl(hostUrl)
			setPreRender(hostUrl)

			footerReadyText.textContent = geti18n('installer_wait_screen.footer.ready_text')
			launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
			launchButtonSpinner.style.display = 'none'

			launchButton.onclick = () => {
				const params = new URLSearchParams({
					theme: theme_now,
					userPreferredLanguages: localStorage.getItem('fountUserPreferredLanguage') || '[]'
				})
				window.location.href = `${hostUrl}?${params}`
			}
			footer?.classList.replace('fixed', 'sticky')
		}
	}, 1000)
}

async function handleStandaloneFlow() {
	launchButtonSpinner.style.display = 'none'
	const savedHostUrl = await getFountHostUrl()

	if (savedHostUrl) {
		launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
		launchButton.onclick = async () => {
			const isOnline = await pingFount(savedHostUrl)
			window.location.href = isOnline ? new URL('/shells/home', savedHostUrl).href : 'fount://page/shells/home'
		}
	}
	else {
		launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_or_install_fount')
		launchButton.onclick = () => {
			window.location.href = 'fount://page/shells/home'
			setTimeout(() => { window.location.href = 'https://github.com/steve02081504/fount' }, 1000)
		}
	}
}

// --- Main Execution ---
async function main() {
	await Promise.all([
		initTranslations('installer_wait_screen'),
		playHeroAnimation()
	])

	adjectiveRotator = createRotatingText(document.getElementById('rotating-adjective'), [], 2500)
	nounRotator = createRotatingText(document.getElementById('rotating-noun'), [], 2500)
	platformRotator = createRotatingText(document.getElementById('rotating-platform'), [], 2500)

	updateRotatingSubtitles()
	populateLanguageSelector()
	renderThemePreviews()

	// Set up Intersection Observers for animations
	const observer = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.classList.add('visible')
				observer.unobserve(entry.target)
			}
		})
	}, { threshold: 0.2 })

	document.querySelectorAll('.feature-section').forEach(section => observer.observe(section))

	const dataShowcaseSection = document.getElementById('data-showcase')
	if (dataShowcaseSection) {
		const dataObserver = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting) {
				startDataShowcaseAnimation()
				dataObserver.unobserve(dataShowcaseSection)
			}
		}, { threshold: 0.2 })
		dataObserver.observe(dataShowcaseSection)
	}

	// Start Fount service check
	if (await checkFountInstallerAlive())
		await handleInstallerFlow()
	else
		await handleStandaloneFlow()
}

main().catch(e => {
	Sentry.captureException(e)
	showToast(geti18n('installer_wait_screen.footer.error_message', { error: e }), 'error')
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
})
