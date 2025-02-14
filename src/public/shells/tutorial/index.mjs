import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()

const tutorialModal = document.getElementById('tutorialModal')
const startTutorialBtn = document.getElementById('startTutorial')
const progressBar = document.getElementById('progressBar')
const progressText = document.getElementById('progressText')
const tutorialEnd = document.getElementById('tutorialEnd')
const progress = progressBar.querySelector('.progress')

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
	showProgressBar(`\
请使用您的手指尝试握住鼠标<img src="https://api.iconify.design/ph/mouse.svg" class="dark:invert">
<br/>
随后移动它
`)

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
	showProgressBar(`\
请找到您的键盘<img src="https://api.iconify.design/ph/keyboard.svg" class="dark:invert">
<br/>
尝试使用您的手指按压键盘
`)

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
	showProgressBar(`\
请找到您的手机<img src="https://api.iconify.design/proicons/phone.svg" class="dark:invert">
<br/>
尝试使用您的任意手指触摸屏幕，再移动它
`)

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
	showProgressBar(`\
请尝试使用您的任意手指触碰手机屏幕<img src="https://api.iconify.design/proicons/phone.svg" class="dark:invert">
<br/>
之后松开
`)

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
