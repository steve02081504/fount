/**
 * 切换主导航视图的高亮与可见性。
 * @param {string} view 视图名（feed / explore / profile / …）
 * @returns {void}
 */
export function activateView(view) {
	for (const button of document.querySelectorAll('.nav-btn'))
		button.classList.toggle('active', button.dataset.view === view)
	for (const section of document.querySelectorAll('.view'))
		section.classList.add('hidden')
	document.getElementById(`${view}View`)?.classList.remove('hidden')
	document.getElementById('composer')?.classList.toggle('hidden', view !== 'feed')
}
