/**
 * 教程 shell 的客户端逻辑。
 */
import { unlockAchievement } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { addDefaultPart, unsetDefaultPart } from '../../scripts/parts.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
/* global confetti */

applyTheme()

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

/**
 * 启动五彩纸屑。
 */
function launchConfetti() {
	confetti?.({
		particleCount: 100,
		spread: 70,
		origin: { y: 0.6 }
	})
}

/**
 * 重置进度。
 */
function resetProgress() {
	progressValue = 0
	clickCount = 0
	progress.value = progressValue
	progressText.innerText = ''
}

/**
 * 显示进度条。
 * @param {string} message - 消息。
 */
function showProgressBar(message) {
	progressBar.classList.remove('hidden')
	progressText.innerHTML = message
	svgInliner(progressBar)
}

/**
 * 隐藏进度条。
 */
function hideProgressBar() {
	progressBar.classList.add('hidden')
}

/**
 * 显示教程结束。
 */
function showTutorialEnd() {
	tutorialEnd.classList.remove('hidden')
}

/**
 * 隐藏教程结束。
 */
function hideTutorialEnd() {
	tutorialEnd.classList.add('hidden')
}

/**
 * 开始鼠标教程。
 */
function startMouseTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.mouseMove', {
		mouseIcon: /* html */ '<img src="https://api.iconify.design/ph/mouse.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('mousemove', handleMouseMove)
}

/**
 * 处理鼠标移动。
 */
function handleMouseMove() {
	progressValue += 10
	progress.value = progressValue

	if (progressValue >= 100) {
		document.removeEventListener('mousemove', handleMouseMove)
		launchConfetti()
		setTimeout(startKeyboardTutorial, 1000)
	}
}

/**
 * 开始键盘教程。
 */
function startKeyboardTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.keyboardPress', {
		keyboardIcon: /* html */ '<img src="https://api.iconify.design/ph/keyboard.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('keydown', handleKeyDown)
}

/**
 * 处理按键。
 */
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

/**
 * 开始移动教程。
 */
function startMobileTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.mobileTouchMove', {
		phoneIcon: /* html */ '<img src="https://api.iconify.design/proicons/phone.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('touchmove', handleTouchMove)
}

/**
 * 处理触摸移动。
 */
function handleTouchMove() {
	progressValue += 10
	progress.value = progressValue

	if (progressValue >= 100) {
		document.removeEventListener('touchmove', handleTouchMove)
		launchConfetti()
		setTimeout(startMobileClickTutorial, 1000)
	}
}

/**
 * 开始移动点击教程。
 */
function startMobileClickTutorial() {
	resetProgress()
	const message = geti18n('tutorial.progressMessages.mobileClick', {
		phoneIcon: /* html */ '<img src="https://api.iconify.design/proicons/phone.svg" class="text-icon inline">',
	})
	showProgressBar(message)

	document.addEventListener('click', handleMobileClick)
}

/**
 * 处理移动点击。
 */
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

await initTranslations('tutorial')

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

/**
 * 关闭教程。
 */
async function closeTutorial() {
	await addDefaultPart('shells', 'home')
	await unsetDefaultPart('shells', 'tutorial')
	if (redirect) window.location.href = decodeURIComponent(redirect) + window.location.hash
	else window.location.href = '/shells/home'
}
skipButton.addEventListener('click', () => {
	unlockAchievement('shells', 'tutorial', 'skip_tutorial')
	closeTutorial()
})
endButton.addEventListener('click', () => {
	unlockAchievement('shells', 'tutorial', 'complete_tutorial')
	closeTutorial()
})
