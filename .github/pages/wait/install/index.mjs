import { setPreRender, setTheme, theme_now } from '../../scripts/base.mjs'
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
const themes = Object.keys(await import('https://cdn.jsdelivr.net/npm/daisyui/theme/object.js').then(m => m.default))

const themeList = document.getElementById('theme-list')

// Render theme previews
async function renderThemePreviews() {
	themeList.innerHTML = ''

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

function launchFount() {
	window.location.href = hostUrl
}

// --- Main Execution ---
function main() {
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
	if (checkFountInstallerAlive()) {
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
		clearInterval(timer)
		return
	}

	// Add event listener to the button
	launchButton.addEventListener('click', launchFount)
}

main()
