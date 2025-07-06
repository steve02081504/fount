import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()

import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
/* global confetti */

const tutorialModal = document.getElementById('tutorialModal')
const startTutorialBtn = document.getElementById('startTutorial')
const progressBar = document.getElementById('progressBar')
const progressText = document.getElementById('progressText')
const tutorialEnd = document.getElementById('tutorialEnd')
const progress = progressBar.querySelector('.progress')
const skipButton = document.getElementById('skipButton')
const endButton = document.getElementById('endButton')

const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent)
let progressValue = 0
let clickCount = 0

function launchConfetti() {
	confetti({
		particleCount: 100,
		spread: 70,
		origin: { y: 0.6 }
	})
}

function resetProgress() {
	progressValue = 0
	clickCount = 0
	progress.value = progressValue
	progressText.innerText = ''
}

function showProgressBar(message) {
	progressBar.classList.remove('hidden')
	progressText.innerHTML = message
	svgInliner(progressBar)
}

function hideProgressBar() {
	progressBar.classList.add('hidden')
}

function showTutorialEnd() {
	tutorialEnd.classList.remove('hidden')
}

function hideTutorialEnd() {
	tutorialEnd.classList.add('hidden')
}

function startMouseTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.mouseMove', {
		mouseIcon: '<img src="https://api.iconify.design/ph/mouse.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('mousemove', handleMouseMove)
}

function handleMouseMove() {
	progressValue += 10
	progress.value = progressValue

	if (progressValue >= 100) {
		document.removeEventListener('mousemove', handleMouseMove)
		launchConfetti()
		setTimeout(startKeyboardTutorial, 1000)
	}
}

function startKeyboardTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.keyboardPress', {
		keyboardIcon: '<img src="https://api.iconify.design/ph/keyboard.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('keydown', handleKeyDown)
}

function handleKeyDown() {
	clickCount++
	progressValue += 5
	progress.value = progressValue

	if (clickCount >= 20) {
		document.removeEventListener('keydown', handleKeyDown)
		hideProgressBar()
		launchConfetti()
		setTimeout(showTutorialEnd, 1000)
	}
}

function startMobileTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.mobileTouchMove', {
		phoneIcon: '<img src="https://api.iconify.design/proicons/phone.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('touchmove', handleTouchMove)
}

function handleTouchMove() {
	progressValue += 10
	progress.value = progressValue

	if (progressValue >= 100) {
		document.removeEventListener('touchmove', handleTouchMove)
		launchConfetti()
		setTimeout(startMobileClickTutorial, 1000)
	}
}

function startMobileClickTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.mobileClick', {
		phoneIcon: '<img src="https://api.iconify.design/proicons/phone.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('click', handleMobileClick)
}

function handleMobileClick() {
	clickCount++
	progressValue += 5
	progress.value = progressValue

	if (clickCount >= 20) {
		document.removeEventListener('click', handleMobileClick)
		hideProgressBar()
		launchConfetti()
		setTimeout(showTutorialEnd, 1000)
	}
}

startTutorialBtn.addEventListener('click', () => {
	tutorialModal.classList.add('hidden')
	hideTutorialEnd()

	if (isMobile)
		startMobileTutorial()
	else
		startMouseTutorial()

})

// 获取 URLSearchParams
const urlParams = new URLSearchParams(window.location.search)
const redirect = urlParams.get('redirect')

function closeTutorial() {
	if (redirect)
		window.location.href = decodeURIComponent(redirect) + window.location.hash
	else
		window.location.href = '/shells/home'
}
skipButton.addEventListener('click', closeTutorial)
endButton.addEventListener('click', closeTutorial)

initTranslations('tutorial')
