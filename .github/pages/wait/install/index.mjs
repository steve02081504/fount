// Main installation page script
import { getFountHostUrl } from '../../scripts/fountHostGetter.mjs'

// Mock i18n function for demonstration
function geti18n(key) {
	const translations = {
		'installer_wait_screen.footer.open_fount': 'Open Fount',
		'installer_wait_screen.footer.launch_button': 'Launch Fount'
	}
	return translations[key] || key
}

async function main() {
	const launchButton = document.getElementById('launchButton')
	const launchButtonText = document.getElementById('launchButtonText')
	const launchButtonSpinner = document.getElementById('launchButtonSpinner')
	
	// Simulate some loading time
	setTimeout(() => {
		// Check if launch to external site should happen
		if (window.location.href.includes('github.io')) {
			setTimeout(() => {
				window.location.href = 'https://github.com/steve02081504/fount'
			}, 1000)
			window.location.href = 'fount://page/shells/home'
		}
		launchButtonSpinner.style.display = 'none'
		
		// Get the host URL using the fixed function
		getFountHostUrl().then(hostUrl => {
			if (hostUrl) {
				launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount')
				launchButton.onclick = () => window.location.href = new URL('/shells/home', hostUrl)
			}
		}).catch(error => {
			console.error('Error getting host URL:', error)
			// Handle error gracefully - button remains with default text
		})
	}, 100)
}

// Start the main function when DOM is loaded
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', main)
} else {
	main()
}