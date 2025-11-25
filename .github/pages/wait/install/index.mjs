import { animateSVG } from 'https://cdn.jsdelivr.net/gh/steve02081504/animate-SVG/index.mjs'
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { setPreRender, setTheme, theme_now } from '../../base.mjs'
import { waitForFountService, saveFountHostUrl, getFountHostUrl, pingFount } from '../../scripts/fountHostGetter.mjs'
import { initTranslations, geti18n, console, getAvailableLocales, getLocaleNames, setLocales, onLanguageChange } from '../../scripts/i18n.mjs'
import { makeSearchable } from '../../scripts/search.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { showToastI18n } from '../../scripts/toast.mjs'

usingTemplates('wait/install/templates')
const hostUrl = 'http://localhost:8931'

// --- DOM Element Selection ---
const launchButton = document.getElementById('launchButton')
const launchButtonText = document.getElementById('launchButtonText')
const launchButtonSpinner = document.getElementById('launchButtonSpinner')
const footer = document.querySelector('.footer')
const footerReadyText = document.getElementById('footerReadyText')
const themeList = document.getElementById('theme-list')
const themeSearch = document.getElementById('theme-search')
const activeUsersCountEl = document.getElementById('active-users-count')
const starsCountEl = document.getElementById('stars-count')

/**
 * 从指定 URL 获取 JSON 数据。
 * @param {string} url - 目标 URL。
 * @param {any} [fallback=null] - 获取失败时的回退值。
 * @returns {Promise<any>} - 获取到的 JSON 数据或回退值。
 */
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

const [initialUserData, initialRepoData] = await Promise.all([
	fetchJson('https://data.jsdelivr.com/v1/stats/packages/gh/steve02081504/fount?period=year'),
	fetchJson('https://api.github.com/repos/steve02081504/fount')
])
const activeUserNum = initialUserData?.hits?.total ?? NaN
const starNum = initialRepoData?.stargazers_count ?? NaN

/**
 * 播放英雄动画。
 */
async function playHeroAnimation() {
	const heroElement = document.querySelector('.hero')
	const animationContainer = document.getElementById('hero-animation-bg')
	const heroOverlay = document.querySelector('.hero-overlay')
	const heroContent = document.querySelector('.hero-content')

	/**
	 * 显示英雄动画的最终状态。
	 * @returns {void}
	 */
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

/**
 * 创建自动主题预览元素。
 * @returns {Promise<HTMLElement>} - 自动主题预览的 DOM 元素。
 */
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

/**
 * 渲染主题预览。
 */
async function renderThemePreviews() {
	themeList.innerHTML = ''
	const themes = await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js').then(m => m.default).catch(() => ['dark', 'light'])

	const allPreviews = []

	// Load custom theme from localStorage if available
	const customThemeName = localStorage.getItem('custom_theme_name')
	const customThemeCss = localStorage.getItem('custom_theme_css')

	// Inject custom theme CSS for preview if available
	if (customThemeName && customThemeCss) {
		let customStyleTag = document.getElementById('custom-theme-preview-css')
		if (!customStyleTag) {
			customStyleTag = document.createElement('style')
			customStyleTag.id = 'custom-theme-preview-css'
			document.head.appendChild(customStyleTag)
		}
		customStyleTag.textContent = customThemeCss
	}

	const autoPreview = await createAutoPreview()
	autoPreview.addEventListener('click', () => handleThemeClick(autoPreview, 'auto'))
	if (!theme_now) autoPreview.classList.add('selected-theme')
	allPreviews.push({ element: autoPreview, name: 'auto' })

	const previewPromises = themes.map(async theme => {
		const preview = await renderTemplate('theme_preview', { theme })
		if (!preview) {
			console.error(`Failed to render preview for theme: ${theme}`)
			return null
		}
		preview.addEventListener('click', () => handleThemeClick(preview, theme))
		if (theme_now === theme) preview.classList.add('selected-theme')
		return { element: preview, name: theme }
	})

	const renderedPreviews = (await Promise.all(previewPromises)).filter(Boolean)
	allPreviews.push(...renderedPreviews)

	// Add custom theme preview if available
	if (customThemeName && customThemeCss) {
		const customPreview = await renderTemplate('theme_preview', { theme: customThemeName, name: customThemeName })
		if (customPreview) {
			customPreview.addEventListener('click', () => handleThemeClick(customPreview, customThemeName))
			if (theme_now === customThemeName) customPreview.classList.add('selected-theme')
			allPreviews.push({ element: customPreview, name: customThemeName })
		}
	}

	themeList.append(...allPreviews.map(p => p.element))

	makeSearchable({
		searchInput: themeSearch,
		data: allPreviews,
		/**
		 * 数据访问器，用于从主题预览项获取名称。
		 * @param {object} item - 主题预览项。
		 * @returns {string} - 主题名称。
		 */
		dataAccessor: item => item.name,
		/**
		 * 更新回调函数，用于根据过滤后的项目更新显示。
		 * @param {Array<object>} filteredItems - 过滤后的项目列表。
		 * @returns {void}
		 */
		onUpdate: (filteredItems) => {
			const visibleElements = new Set(filteredItems)
			allPreviews.forEach(item => {
				item.element.style.display = visibleElements.has(item) ? '' : 'none'
			})
		}
	})
}

/**
 * 处理主题点击事件。
 * @param {HTMLElement} previewElement - 被点击的预览元素。
 * @param {string} theme - 选中的主题名称。
 * @returns {void}
 */
function handleThemeClick(previewElement, theme) {
	/**
	 * 应用新主题
	 */
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

/**
 * 动画计数器。
 * @param {HTMLElement} element - 要动画的 DOM 元素。
 * @param {number} start - 起始值。
 * @param {number} end - 结束值。
 * @param {number} duration - 动画持续时间（毫秒）。
 * @param {number} [easingPower=5] - 缓动强度。
 * @returns {Promise<void>}
 */
function animateCounter(element, start, end, duration, easingPower = 5) {
	return new Promise(resolve => {
		// if active from start, just set and resolve
		if (element.dataset.easterEggActive === 'true') {
			element.textContent = end.toLocaleString()
			return resolve()
		}

		if (start === end) {
			element.textContent = end.toLocaleString()
			return resolve()
		}
		let startTime = null
		/**
		 * 动画的步进函数。
		 * @param {DOMHighResTimeStamp} timestamp - 当前时间戳。
		 * @returns {void}
		 */
		const step = timestamp => {
			// if activated during animation, set to end and resolve
			if (element.dataset.easterEggActive === 'true') {
				element.textContent = end.toLocaleString()
				return resolve()
			}

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

/**
 * 启动数据展示动画。
 */
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

	setInterval(async () => {
		const [userData, repoData] = await Promise.all([
			fetchJson('https://data.jsdelivr.com/v1/stats/packages/gh/steve02081504/fount?period=year'),
			fetchJson('https://api.github.com/repos/steve02081504/fount')
		])

		const newActiveUserNum = userData?.hits?.total ?? NaN
		const newStarNum = repoData?.stargazers_count ?? NaN

		/**
		 * 更新统计数据。
		 * @param {HTMLElement} element - 显示统计数据的 DOM 元素。
		 * @param {number} newValue - 新的统计值。
		 * @param {number} shortDuration - 短动画持续时间。
		 * @returns {void}
		 */
		const updateStat = (element, newValue, shortDuration) => {
			const currentDisplayed = parseInt(element.textContent.replace(/,/g, ''), 10)
			if (!isNaN(newValue) && newValue !== currentDisplayed)
				animateCounter(element, isNaN(currentDisplayed) ? 0 : currentDisplayed, newValue, shortDuration, 3)
		}

		updateStat(activeUsersCountEl, newActiveUserNum, SHORT_ANIMATION_DURATION)
		updateStat(starsCountEl, newStarNum, SHORT_ANIMATION_DURATION)
	}, 60 * 1000)
}

/**
 * 创建一个旋转文本组件。
 * @param {HTMLElement} container - 包含旋转文本的 DOM 元素。
 * @param {string[]} initialWords - 初始单词数组。
 * @param {number} interval - 旋转间隔时间（毫秒）。
 * @returns {{updateWords: Function, stop: Function, start: Function}} - 包含更新单词、停止和启动方法的对象。
 */
function createRotatingText(container, initialWords, interval) {
	let words = initialWords
	let currentIndex = 0
	let intervalId = null
	let spans = []

	/**
	 * 设置旋转文本组件。
	 * @returns {void}
	 */
	const setup = () => {
		container.innerHTML = ''
		spans = words.map(word => {
			const span = document.createElement('span')
			span.innerHTML = word.replaceAll(' ', '&nbsp;')
			container.appendChild(span)
			return span
		})
	}

	/**
	 * 更新旋转文本的显示。
	 * @returns {void}
	 */
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

	/**
	 * 旋转文本。
	 * @returns {void}
	 */
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

	/**
	 * 启动旋转文本。
	 * @returns {void}
	 */
	const start = () => {
		if (!intervalId && words.length >= 2) intervalId = setInterval(rotate, interval)
	}
	/**
	 * 停止旋转文本。
	 * @returns {void}
	 */
	const stop = () => {
		if (intervalId) clearInterval(intervalId)
		intervalId = null
	}

	setup()
	updateDisplay()
	start()

	return {
		/**
		 * 更新旋转文本的单词。
		 * @param {string[]} newWords - 新的单词数组。
		 * @returns {void}
		 */
		updateWords: newWords => {
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

/**
 * 更新旋转文本的子标题。
 */
function updateRotatingSubtitles() {
	adjectiveRotator?.updateWords(geti18n('installer_wait_screen.data_showcase.adjectives') || [])
	nounRotator?.updateWords(geti18n('installer_wait_screen.data_showcase.nouns') || [])
	platformRotator?.updateWords(geti18n('installer_wait_screen.data_showcase.platforms') || [])
}

// --- Language Selector ---

/**
 * 填充语言选择器。
 */
function populateLanguageSelector() {
	const languageSelector = document.getElementById('language-selector')
	const languageSearch = document.getElementById('language-search')
	if (!languageSelector || !languageSearch) return

	languageSelector.innerHTML = '' // Clear existing items
	const locales = getAvailableLocales()
	const localeNames = getLocaleNames()

	const items = locales.map(locale => {
		const li = document.createElement('li')
		const a = document.createElement('div')
		a.textContent = localeNames.get(locale) || locale
		/**
		 * 处理语言选择点击事件。
		 * @param {Event} e - 点击事件对象。
		 * @returns {Promise<void>}
		 */
		a.onclick = async e => {
			e.preventDefault()
			await setLocales([locale])
			document.activeElement?.blur()
		}
		li.appendChild(a)
		return { element: li, locale, name: a.textContent }
	})

	languageSelector.append(...items.map(item => item.element))

	makeSearchable({
		searchInput: languageSearch,
		data: items,
		/**
		 * 数据访问器，用于从项目获取名称和语言环境。
		 * @param {object} item - 列表中的项目。
		 * @returns {{name: string, locale: string}} - 包含名称和语言环境的对象。
		 */
		dataAccessor: item => ({ name: item.name, locale: item.locale }),
		/**
		 * 更新回调函数，用于根据过滤后的项目更新显示。

		 * @param {Array<object>} filteredItems - 过滤后的项目列表。
		 * @returns {void}
		 */
		onUpdate: (filteredItems) => {
			const visibleElements = new Set(filteredItems)
			items.forEach(item => {
				item.element.style.display = visibleElements.has(item) ? '' : 'none'
			})
		}
	})
}

// --- fount Service Connection Logic ---

/**
 * 检查 fount 安装程序是否存活。
 * @returns {Promise<boolean>} - 如果安装程序存活则返回 true，否则返回 false。
 */
const checkFountInstallerAlive = async () => {
	try {
		return (await fetch('http://localhost:8930', { cache: 'no-store' })).ok
	}
	catch {
		return false
	}
}

/**
 * 等待 fount 安装程序失败。
 * @returns {Promise<void>}
 */
const whenFountInstallerFails = () => {
	return new Promise(resolve => {
		const timer = setInterval(() => {
			if (checkFountInstallerAlive()) return
			clearInterval(timer)
			resolve()
		}, 1000)
	})
}

/**
 * 处理 fount 安装程序流程。
 */
async function handleInstallerFlow() {
	document.getElementById('theme-selection-section').style.display = 'block'
	document.getElementById('mini-game-section').style.display = 'block'
	footerReadyText.dataset.i18n = 'installer_wait_screen.footer.wait_text'

	whenFountInstallerFails().then(() => {
		window.location.href = './error'
	})

	waitForFountService(hostUrl).then(() => {
		saveFountHostUrl(hostUrl)
		setPreRender(hostUrl)

		footerReadyText.dataset.i18n = 'installer_wait_screen.footer.ready_text'
		launchButtonText.dataset.i18n = 'installer_wait_screen.footer.open_fount'
		launchButtonSpinner.style.display = 'none'

		/**
		 * @type {() => void}
		 */
		launchButton.onclick = () => {
			const params = new URLSearchParams({
				theme: theme_now,
				userPreferredLanguages: localStorage.getItem('fountUserPreferredLanguages') || '[]'
			})
			window.location.href = `${hostUrl}?${params}`
		}
		footer?.classList.replace('fixed', 'sticky')
	})
}

/**
 * 处理独立模式流程。
 */
async function handleStandaloneFlow() {
	launchButtonSpinner.style.display = 'none'

	launchButtonText.dataset.i18n = 'installer_wait_screen.footer.open_or_install_fount'
	/**
	 * 在 fount 服务不可用时打开主页。
	 */
	launchButton.onclick = () => {
		window.location.href = 'fount://page/'
		setTimeout(() => { window.location.href = 'https://github.com/steve02081504/fount' }, 5000)
	}

	const savedHostUrl = await getFountHostUrl()

	if (savedHostUrl) {
		launchButtonText.dataset.i18n = 'installer_wait_screen.footer.open_fount'
		/**
		 * 在 fount 服务可用时打开主页。
		 */
		launchButton.onclick = async () => {
			const isOnline = await pingFount(savedHostUrl)
			window.location.href = isOnline ? savedHostUrl : 'fount://page/'
		}
	}
}

/**
 * 主函数，初始化翻译并启动流程。
 */
async function main() {
	await Promise.all([
		initTranslations('installer_wait_screen'),
		playHeroAnimation()
	])

	adjectiveRotator = createRotatingText(document.getElementById('rotating-adjective'), [], 2500)
	nounRotator = createRotatingText(document.getElementById('rotating-noun'), [], 2500)
	platformRotator = createRotatingText(document.getElementById('rotating-platform'), [], 2500)

	onLanguageChange(updateRotatingSubtitles)
	populateLanguageSelector()
	renderThemePreviews()

	// --- Easter Egg ---
	const shakeStates = new Map()
	const SHAKE_DECAY_TIME = 2000 // ms before shake starts to decay
	const MAX_CLICKS_TO_ACTIVATE = 13
	const MAX_SHAKE_INTENSITY = 5

	/**
	 * Gradually reduces the shake intensity until it stops.
	 * @param {HTMLElement} element The element to decay shake for.
	 * @returns {void}
	 */
	function decayShake(element) {
		const state = shakeStates.get(element)
		if (!state) return

		state.intensity *= 0.9 // Decay factor

		if (state.intensity < 0.5) { // Stop shaking if intensity is too low
			state.intensity = 0
			state.clicks = 0
			element.classList.remove('shaking')
			shakeStates.delete(element)
		}
		else {
			element.style.setProperty('--shake-intensity', state.intensity.toString())
			state.timer = setTimeout(() => decayShake(element), 100)
		}
	}

	/**
	 * Applies a decaying shake effect to an element on click.
	 * @param {HTMLElement} element The element to make shakable.
	 * @returns {void}
	 */
	function setupClickToShake(element) {
		if (!element) return
		element.style.cursor = 'pointer'

		element.addEventListener('click', () => {
			// If easter egg is fully active, do nothing.
			if (element.dataset.easterEggActive === 'true') return

			let state = shakeStates.get(element)
			if (!state) {
				state = { clicks: 0, intensity: 0, timer: null }
				shakeStates.set(element, state)
			}

			clearTimeout(state.timer) // Reset decay timer on new click

			state.clicks++
			// Increase intensity with a cap.
			state.intensity = Math.min(state.clicks * 0.5, MAX_SHAKE_INTENSITY)

			// Apply shake
			if (state.intensity > 0) {
				element.style.setProperty('--shake-intensity', state.intensity.toString())
				element.classList.add('shaking')
			}

			if (state.clicks >= MAX_CLICKS_TO_ACTIVATE) {
				element.dataset.easterEggActive = 'true'
				// Easter egg activated, let it shake for a bit then stop.
				setTimeout(() => {
					element.classList.remove('shaking')
					shakeStates.delete(element)
				}, SHAKE_DECAY_TIME)
				return
			}

			// Start decay timer.
			state.timer = setTimeout(() => decayShake(element), SHAKE_DECAY_TIME)
		})
	}

	setupClickToShake(activeUsersCountEl)
	setupClickToShake(starsCountEl)

	// Set up Intersection Observers for animations
	const observer = new IntersectionObserver(entries => {
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
		const dataObserver = new IntersectionObserver(entries => {
			if (entries[0].isIntersecting) {
				startDataShowcaseAnimation()
				dataObserver.unobserve(dataShowcaseSection)
			}
		}, { threshold: 0.2 })
		dataObserver.observe(dataShowcaseSection)
	}

	// Start fount service check
	if (await checkFountInstallerAlive())
		await handleInstallerFlow()
	else
		await handleStandaloneFlow()
}

main().catch(e => {
	Sentry.captureException(e)
	showToastI18n('error', 'installer_wait_screen.footer.error_message', { error: e })
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
})
