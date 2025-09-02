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

const launchButton = document.getElementById('launchButton')
const launchButtonText = document.getElementById('launchButtonText')
const launchButtonSpinner = document.getElementById('launchButtonSpinner')
const footer = document.querySelector('.footer')
const footerReadyText = document.getElementById('footerReadyText')

const [activeUserNum, starNum] = await Promise.all([
	fetch('https://data.jsdelivr.com/v1/stats/packages/gh/steve02081504/fount?period=year').then(res => res.json()).then(data => data.hits.total).catch(() => NaN),
	fetch('https://api.github.com/repos/steve02081504/fount').then(res => res.json()).then(data => data.stargazers_count).catch(() => NaN)
])

// --- Hero Intro Animation ---
async function playHeroAnimation() {
	const heroElement = document.querySelector('.hero')
	const animationContainer = document.getElementById('hero-animation-bg')
	const heroOverlay = document.querySelector('.hero-overlay')
	const heroContent = document.querySelector('.hero-content')

	try {
		// 1. 锁定滚动
		document.body.classList.add('scroll-lock')

		const response = await fetch('https://steve02081504.github.io/fount/imgs/repo-img.svg')
		if (!response.ok) throw new Error(`Failed to load SVG: ${response.statusText}`)

		const svgText = await response.text()
		const svgElement = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement

		// 确保SVG preserveAspectRatio 与 object-fit: cover 行为匹配
		svgElement.setAttribute('preserveAspectRatio', 'xMidYMid slice')

		animationContainer.appendChild(svgElement)

		// 播放动画并获取持续时间
		animateSVG(svgElement)
		const durationMs = 3100

		// 动画结束后执行
		setTimeout(() => {
			// 1. 淡入 Hero 文字和遮罩
			heroOverlay.classList.add('visible-after-intro')
			heroContent.classList.add('visible-after-intro')

			// 2. 加载最终的背景图
			heroElement.classList.add('bg-image-loaded')

			// 3. 淡出 SVG 动画
			animationContainer.style.opacity = '0'

			// 4. 解锁滚动
			document.body.classList.remove('scroll-lock')

			// 5. 在淡出动画后彻底移除SVG，释放资源
			animationContainer.addEventListener('transitionend', () => animationContainer.remove(), { once: true })
		}, durationMs)
	}
	catch (error) {
		console.error('Hero animation failed:', error)
		// 如果动画失败，直接显示最终效果
		heroOverlay.classList.add('visible-after-intro')
		heroContent.classList.add('visible-after-intro')
		heroElement.classList.add('bg-image-loaded')
		animationContainer.remove()
		// 确保在出错时也解锁滚动
		document.body.classList.remove('scroll-lock')
	}
}

// --- Theme Selection ---
const themes = await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js').then(m => m.default)

const themeList = document.getElementById('theme-list')

// Create "Auto" theme preview function
async function createAutoPreview() {
	const container = document.createElement('div')
	container.classList.add('theme-preview-card', 'cursor-pointer', 'auto-theme-container')

	const darkHalf = await renderTemplate('theme_preview', { theme: 'dark', name: 'auto' })
	const lightHalf = await renderTemplate('theme_preview', { theme: 'light', name: 'auto' })

	darkHalf.classList.add('auto-theme-half', 'auto-theme-dark')
	lightHalf.classList.add('auto-theme-half', 'auto-theme-light')

	container.appendChild(lightHalf)
	container.appendChild(darkHalf)

	return container
}

// Render theme previews
async function renderThemePreviews() {
	themeList.innerHTML = ''

	const currentTheme = theme_now

	// Create "Auto" theme preview
	const autoPreview = await createAutoPreview()
	autoPreview.addEventListener('click', () => handleThemeClick(autoPreview, 'auto'))
	if (!currentTheme) autoPreview.classList.add('selected-theme')
	themeList.appendChild(autoPreview)

	for (const theme of themes) {
		const preview = await renderTemplate('theme_preview', { theme })

		if (!preview) {
			console.error(`Failed to render preview for theme: ${theme}`)
			continue
		}

		preview.addEventListener('click', () => handleThemeClick(preview, theme))

		if (theme_now === theme)
			preview.classList.add('selected-theme')

		themeList.appendChild(preview)
	}
}

// Update selected theme style
function updateSelectedTheme(selectedElement) {
	document.querySelectorAll('.theme-preview-card').forEach(el => el.classList.remove('selected-theme'))
	selectedElement.classList.add('selected-theme')
}

// Handle theme click
function handleThemeClick(previewElement, theme) {
	const applyNewTheme = () => {
		setTheme(theme)
		updateSelectedTheme(previewElement)
	}

	if (!document.startViewTransition) {
		applyNewTheme()
		return
	}

	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	if (prefersReducedMotion) {
		applyNewTheme()
		return
	}

	document.startViewTransition(applyNewTheme)
}

// --- Data Showcase Animation ---
/**
 * 动画化一个数字计数器，返回一个在动画完成时解析的 Promise。
 * @param {HTMLElement} element - 显示数字的 DOM 元素。
 * @param {number} start - 起始数字。
 * @param {number} end - 结束数字。
 * @param {number} duration - 动画持续时间（毫秒）。
 * @param {number} easingPower - 缓动函数的强度，值越大，初始速度越快，末尾速度越慢。
 */
function animateCounter(element, start, end, duration, easingPower = 5) {
	return new Promise(resolve => {
		if (start === end) {
			element.textContent = end.toLocaleString()
			resolve()
			return
		}
		let startTime = null

		const step = (timestamp) => {
			if (!startTime) startTime = timestamp
			const progress = Math.min((timestamp - startTime) / duration, 1)

			// 应用一个更强的 ease-out 函数 (easeOutQuint)
			// 这会使得动画开始时非常快，然后急剧减速，末尾阶段非常缓慢
			const easedProgress = 1 - Math.pow(1 - progress, easingPower)

			const currentValue = Math.floor(start + (end - start) * easedProgress)
			element.textContent = currentValue.toLocaleString()

			if (progress < 1)
				window.requestAnimationFrame(step)
			else {
				element.textContent = end.toLocaleString()
				resolve() // 动画完成，解析 Promise
			}
		}

		window.requestAnimationFrame(step)
	})
}


async function startDataShowcaseAnimation() {
	const adjectives = geti18n('installer_wait_screen.data_showcase.adjectives') || []
	const nouns = geti18n('installer_wait_screen.data_showcase.nouns') || []
	const platforms = geti18n('installer_wait_screen.data_showcase.platforms') || []

	const rotatingAdjectiveEl = document.getElementById('rotating-adjective')
	const rotatingNounEl = document.getElementById('rotating-noun')
	const rotatingPlatformEl = document.getElementById('rotating-platform')

	if (adjectives.length > 0) setupTextRotation(rotatingAdjectiveEl, adjectives, 2500)
	if (nouns.length > 0) setupTextRotation(rotatingNounEl, nouns, 2500)
	if (platforms.length > 0) setupTextRotation(rotatingPlatformEl, platforms, 2500)

	const activeUsersCountEl = document.getElementById('active-users-count')
	const starsCountEl = document.getElementById('stars-count')

	// 定义动画时长
	const LONG_ANIMATION_DURATION = 5 * 60 * 1000 // 5 分钟
	const SHORT_ANIMATION_DURATION = 3000 // 3 秒用于更新

	// 1. 播放初始的、非常长的动画
	const initialAnimations = []
	if (!isNaN(activeUserNum)) {
		const animationPromise = animateCounter(activeUsersCountEl, 0.8 * activeUserNum, activeUserNum, LONG_ANIMATION_DURATION)
		initialAnimations.push(animationPromise)
	}
	else
		activeUsersCountEl.textContent = '?'

	if (!isNaN(starNum)) {
		const animationPromise = animateCounter(starsCountEl, 0.8 * starNum, starNum, LONG_ANIMATION_DURATION)
		initialAnimations.push(animationPromise)
	}
	else
		starsCountEl.textContent = '?'


	// 2. 等待所有初始动画完成后，启动周期性更新检查
	await Promise.all(initialAnimations)
	console.log('Initial number animation complete. Starting periodic updates every minute.')

	// 3. 每隔一分钟重新拉取数字并更新
	setInterval(async () => {
		try {
			// 并行获取新数据
			const [newActiveUserNumRes, newStarNumRes] = await Promise.all([
				fetch('https://data.jsdelivr.com/v1/stats/packages/gh/steve02081504/fount?period=year'),
				fetch('https://api.github.com/repos/steve02081504/fount')
			])

			const newActiveUserNum = await newActiveUserNumRes.json().then(data => data.hits.total).catch(() => NaN)
			const newStarNum = await newStarNumRes.json().then(data => data.stargazers_count).catch(() => NaN)

			// 获取当前显示的数字
			const currentDisplayedUsers = parseInt(activeUsersCountEl.textContent.replace(/,/g, ''), 10)
			const currentDisplayedStars = parseInt(starsCountEl.textContent.replace(/,/g, ''), 10)

			// 检查用户数是否有变化，并播放更新动画
			if (!isNaN(newActiveUserNum) && newActiveUserNum !== currentDisplayedUsers) {
				console.log(`Updating active users from ${currentDisplayedUsers} to ${newActiveUserNum}`)
				animateCounter(activeUsersCountEl, isNaN(currentDisplayedUsers) ? 0 : currentDisplayedUsers, newActiveUserNum, SHORT_ANIMATION_DURATION, 3)
			}

			// 检查 Star 数是否有变化，并播放更新动画
			if (!isNaN(newStarNum) && newStarNum !== currentDisplayedStars) {
				console.log(`Updating stars from ${currentDisplayedStars} to ${newStarNum}`)
				animateCounter(starsCountEl, isNaN(currentDisplayedStars) ? 0 : currentDisplayedStars, newStarNum, SHORT_ANIMATION_DURATION, 3)
			}
		}
		catch (error) {
			console.error('Failed to fetch updated stats:', error)
		}
	}, 60 * 1000)
}

function setupTextRotation(container, words, interval) {
	if (!container || !words || words.length < 2) return

	container.innerHTML = '' // Clear any existing content
	words.forEach((word) => {
		const span = document.createElement('span')
		span.textContent = word
		container.appendChild(span)
	})

	const spans = Array.from(container.children)
	let currentIndex = Math.floor(Math.random() * spans.length)

	const updateText = () => {
		const currentSpan = spans[currentIndex]

		const nextIndex = Math.floor(Math.random() * spans.length)

		const nextSpan = spans[nextIndex]

		// Adjust container width for the incoming text
		container.style.width = `${nextSpan.offsetWidth}px`

		// Animate out the current text
		currentSpan.classList.remove('active')
		currentSpan.classList.add('exiting')

		// Animate in the next text
		nextSpan.classList.remove('exiting') // In case it was there from a previous cycle
		nextSpan.classList.add('active')

		// Clean up the exiting class after animation
		setTimeout(() => {
			currentSpan.classList.remove('exiting')
		}, 500) // a bit longer than transition duration

		currentIndex = nextIndex
	}

	// Initial state
	const firstSpan = spans[currentIndex]
	container.style.width = `${firstSpan.offsetWidth}px`
	firstSpan.classList.add('active')

	setInterval(updateText, interval)
}

async function populateLanguageSelector() {
	const languageSelector = document.getElementById('language-selector')
	if (!languageSelector) return

	const locales = getAvailableLocales()
	const localeNames = getLocaleNames()

	languageSelector.innerHTML = '' // Clear existing items

	locales.forEach(locale => {
		const li = document.createElement('li')
		const a = document.createElement('a')
		a.textContent = localeNames.get(locale) || locale
		a.addEventListener('click', (e) => {
			e.preventDefault()
			setLocales([locale])
			// Close dropdown after selection
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur()

		})
		li.appendChild(a)
		languageSelector.appendChild(li)
	})
}

// --- Main Execution ---
async function main() {
	// Start the intro animation and translations in parallel
	await Promise.all([
		initTranslations('installer_wait_screen'),
		playHeroAnimation()
	])

	populateLanguageSelector() // Call the new function

	// Initial render
	renderThemePreviews()

	// Set up animations
	const featureSections = document.querySelectorAll('.feature-section')
	const observer = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.classList.add('visible')
				observer.unobserve(entry.target)
			}
		})
	}, { threshold: 0.2 })
	featureSections.forEach(section => {
		observer.observe(section)
	})

	const dataShowcaseSection = document.getElementById('data-showcase')
	if (dataShowcaseSection) {
		const dataObserver = new IntersectionObserver((entries) => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					startDataShowcaseAnimation()
					dataObserver.unobserve(entry.target)
				}
			})
		}, { threshold: 0.2 })
		dataObserver.observe(dataShowcaseSection)
	}

	// Start fount service check
	async function checkFountInstallerAlive() {
		try {
			const response = await fetch('http://localhost:8930')
			if (!response.ok) return false
		}
		catch (e) { return false }
		return true
	}
	if (await checkFountInstallerAlive()) {
		document.getElementById('theme-selection-section').style.display = 'block'
		document.getElementById('mini-game-section').style.display = 'block'
		footerReadyText.textContent = geti18n('installer_wait_screen.footer.wait_text')
		const timer = setInterval(async () => {
			if (!await checkFountInstallerAlive()) {
				window.location.href = './error'
				clearInterval(timer)
				return
			}
			if (await isFountServiceAvailable(hostUrl)) {
				saveFountHostUrl(hostUrl)
				setPreRender(hostUrl)
				footerReadyText.textContent = geti18n('installer_wait_screen.footer.ready_text')
				launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
				launchButton.onclick = () => {
					const params = new URLSearchParams()
					params.set('theme', theme_now)
					params.set('userPreferredLanguages', localStorage.getItem('fountUserPreferredLanguage') || '[]')
					window.location.href = hostUrl + '?' + params.toString()
				}
				launchButtonSpinner.style.display = 'none'

				if (footer) {
					footer.classList.remove('fixed', 'bottom-0', 'w-full', 'z-50')
					footer.classList.add('sticky', 'bottom-0', 'w-full', 'z-50')
				}

				clearInterval(timer)
			}
		}, 1000)
	}
	else {
		launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_or_install_fount')
		launchButton.onclick = () => {
			setTimeout(() => {
				window.location.href = 'https://github.com/steve02081504/fount'
			}, 1000)
			window.location.href = 'fount://page/shells/home'
		}
		launchButtonSpinner.style.display = 'none'
		const hostUrl = await getFountHostUrl()

		if (hostUrl) {
			launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
			launchButton.onclick = async () => (await pingFount(hostUrl)) ? window.location.href = new URL('/shells/home', hostUrl) : window.open('fount://page/shells/home', '_self')
		}
		return
	}
}

main().catch(e => {
	Sentry.captureException(e)
	showToast(geti18n('installer_wait_screen.footer.error_message', { error: e }), 'error')
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
})
