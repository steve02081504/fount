import { Sentry, setPreRender, setTheme, theme_now } from '../../scripts/base.mjs'
import { isFountServiceAvailable, saveFountHostUrl } from '../../scripts/fountHostGetter.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'

usingTemplates('../../wait/install/templates')
const hostUrl = 'http://localhost:8931'

const launchButton = document.getElementById('launchButton')
const launchButtonText = document.getElementById('launchButtonText')
const launchButtonSpinner = document.getElementById('launchButtonSpinner')
const footer = document.querySelector('.footer')
const themeSelectionSection = document.getElementById('theme-selection-section')

// --- Theme Selection ---
const themes = Object.keys(await import('https://cdn.jsdelivr.net/npm/daisyui/theme/object.js').then(m => m.default)).sort()

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
	autoPreview.addEventListener('click', () => handleThemeClick(autoPreview, null))
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

// --- Main Execution ---
async function main() {
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

	// Start Fount service check
	async function checkFountInstallerAlive() {
		try {
			const response = await fetch('http://localhost:8930')
			if (!response.ok) return false
		}
		catch (e) { return false }
		return true
	}
	if (await checkFountInstallerAlive()) {
		const timer = setInterval(async () => {
			if (!await checkFountInstallerAlive()) {
				window.location.href = './error'
				clearInterval(timer)
				return
			}
			if (await isFountServiceAvailable(hostUrl)) {
				saveFountHostUrl(hostUrl)
				setPreRender(hostUrl)
				launchButton.disabled = false
				launchButtonText.textContent = 'Open fount'
				launchButton.onclick = () => window.location.href = new URL('/shells/home', hostUrl)
				launchButtonSpinner.style.display = 'none'

				if (footer) {
					footer.classList.remove('fixed', 'bottom-0', 'w-full', 'z-50')
					footer.classList.add('sticky')
				}

				clearInterval(timer)
			}
		}, 1000)
	}
	else {
		// Installer is not running, hide theme section, change button
		themeSelectionSection.style.display = 'none'
		launchButtonText.textContent = 'Install fount'
		launchButton.onclick = () => { window.location.href = 'https://github.com/steve02081504/fount' }
		launchButtonSpinner.style.display = 'none'
		launchButton.disabled = false // Enable the button to install
		const hostUrl = await getFountHostUrl()

		if (hostUrl) {
			launchButton.disabled = false
			launchButtonText.textContent = 'Open fount'
			launchButton.onclick = () => window.location.href = new URL('/shells/home', hostUrl)
		}
		return
	}
}

main().catch(e => {
	Sentry.captureException(e)
	alert('awww :(\n\nAn error occurred:\n' + e.message)
	window.location.href = 'https://github.com/steve02081504/fount'
})
