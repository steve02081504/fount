// error.js
const errorMessage = document.getElementById('errorMessage')
const errorMessageText = document.getElementById('errorMessageText')
let hideTimeout = null
let fadeTimeout = null

/**
 * 显示错误信息
 * @param {string} message 错误信息
 */
export function showErrorMessage(message) {
	errorMessageText.textContent = message
	errorMessage.classList.remove('hidden', 'fade-out') // 移除 fade-out 类
	errorMessage.classList.add('fade-in') // 添加 fade-in 类
	setHideTimeout()
}

/**
 * 设置隐藏错误信息的定时器
 */
function setHideTimeout() {
	clearTimeout(hideTimeout)
	clearTimeout(fadeTimeout)
	hideTimeout = setTimeout(() => {
		// 开始渐出效果
		errorMessage.classList.add('fade-out')
		errorMessage.classList.remove('fade-in')
		// 渐出效果结束后隐藏
		fadeTimeout = setTimeout(() => {
			errorMessage.classList.add('hidden')
		}, 2000)
	}, 2000) // 2秒后开始渐出
}

/**
 * 检查是否有选中的文本
 * @returns {boolean} 如果有选中的文本，返回 true，否则返回 false
 */
function isTextSelected() {
	return window.getSelection().toString() !== ''
}

// 错误信息鼠标进入事件
errorMessage.addEventListener('mouseenter', () => {
	clearTimeout(hideTimeout)
	clearTimeout(fadeTimeout)
	errorMessage.classList.remove('fade-out') // 移除 fade-out 类
})

// 错误信息鼠标离开事件
errorMessage.addEventListener('mouseleave', () => {
	if (!isTextSelected())
		setHideTimeout()

})

// 错误信息文本选中变化事件
errorMessage.addEventListener('selectstart', () => {
	clearTimeout(hideTimeout)
	clearTimeout(fadeTimeout)
	errorMessage.classList.remove('fade-out') // 移除 fade-out 类
})

// 当文本选择变化且没有文本被选中时，重新设置定时器
document.addEventListener('selectionchange', () => {
	if (!isTextSelected() && !errorMessage.matches(':hover'))
		setHideTimeout()

})

//手机触摸事件
errorMessage.addEventListener('touchstart', () => {
	clearTimeout(hideTimeout)
	clearTimeout(fadeTimeout)
	errorMessage.classList.remove('fade-out') // 移除 fade-out 类
})
