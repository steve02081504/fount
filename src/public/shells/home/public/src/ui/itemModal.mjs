import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { geti18n } from '../../../../scripts/i18n.mjs'
import { svgInliner } from '../../../../scripts/svgInliner.mjs'
import { renderTemplate } from '../../../../scripts/template.mjs'
import { defaultIcons, genericDefaultIcon } from '../constants.mjs'

const itemModal = document.getElementById('item-modal')
const itemModalContent = document.getElementById('item-modal-content')

/**
 * 创建一个给定部件的动作按钮。
 * @param {object} part - 包含部件类型、部件名称、部件详细信息和部件类型配置的部件对象。
 * @returns {HTMLAnchorElement[]} 一个按钮元素数组。
 */
export function createActionButtons(part) {
	const { parttype, partname, partdetails, partTypeConfig } = part
	const interfacesRegistry = partTypeConfig.interfaces
	const buttons = []

	for (const interfaceItem of interfacesRegistry)
		if (!interfaceItem.interface || partdetails.supportedInterfaces.includes(interfaceItem.interface)) {
			const button = document.createElement('a')
			const classes = ['btn', `btn-${interfaceItem.type ?? 'primary'}`, ...interfaceItem.classes ? interfaceItem.classes.split(' ') : []]
			button.classList.add(...classes)
			if (interfaceItem.style) button.style.cssText = interfaceItem.style

			button.innerHTML = interfaceItem.button ?? /* html */ '<img src="https://api.iconify.design/line-md/question-circle.svg" />'
			button.title = interfaceItem.info.title
			svgInliner(button)

			if (interfaceItem.onclick)
				button.addEventListener('click', (e) => {
					e.stopPropagation() // 防止点击冒泡到模态框背景
					async_eval(interfaceItem.onclick.replaceAll('${name}', partname).replaceAll('${type}', parttype), { geti18n })
				})

			else {
				button.href = interfaceItem.url.replaceAll('${name}', partname).replaceAll('${type}', parttype)
				button.addEventListener('click', e => e.stopPropagation())
			}
			buttons.push(button)
		}

	return buttons
}

/**
 * 填充并显示项目详情模态框。
 * @param {object} part - 包含部件类型、部件名称和部件详细信息的部件对象。
 */
export async function showItemModal(part) {
	const { parttype, partname, partdetails } = part
	const dataForTemplate = { ...partdetails, parttype, defaultIcon: defaultIcons[parttype] || genericDefaultIcon }

	itemModalContent.innerHTML = '' // 清除先前的内容
	const modalView = await renderTemplate('item_modal_view', dataForTemplate)
	itemModalContent.appendChild(modalView)

	const imageWrapper = modalView.querySelector('.modal-image-wrapper')
	if (imageWrapper)
		window.VanillaTilt?.init?.(imageWrapper, {
			max: 15,
			speed: 400,
			glare: true,
			'max-glare': 0.5,
		})

	itemModal.addEventListener('close', () => {
		const tiltEl = itemModalContent.querySelector('.modal-image-wrapper')
		if (tiltEl && tiltEl.vanillaTilt)
			tiltEl.vanillaTilt.destroy()

	}, { once: true })

	const actionsContainer = modalView.querySelector('.modal-actions-container')
	const buttons = createActionButtons(part) // Pass the part object

	buttons.forEach(btn => actionsContainer.appendChild(btn))

	setTimeout(() => {
		const containerRect = actionsContainer.getBoundingClientRect()
		const centerX = containerRect.width / 2
		const centerY = containerRect.height / 2
		const radius = Math.min(centerX, centerY) * 1.2
		const angleStep = buttons.length > 0 ? (2 * Math.PI) / buttons.length : 0

		buttons.forEach((button, index) => {
			button.style.animationDelay = `${Math.random() * 6}s`
			const angle = angleStep * index - (Math.PI / 2)
			const x = centerX + radius * Math.cos(angle)
			const y = centerY + radius * Math.sin(angle)
			button.style.left = `${x}px`
			button.style.top = `${y}px`
		})
	}, 100)

	itemModal.showModal()
}
