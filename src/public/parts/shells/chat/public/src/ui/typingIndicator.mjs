import { geti18n } from '../../../../../scripts/i18n.mjs'
import { getPartDetails } from '../../../../../scripts/parts.mjs'

const typingIndicatorElement = document.getElementById('typing-indicator')
let typingChars = new Set()

/**
 * 更新正在输入的指示器
 */
async function updateTypingIndicator() {
	if (!typingChars.size) {
		typingIndicatorElement.classList.add('hidden')
		typingIndicatorElement.innerHTML = ''
		return
	}

	typingIndicatorElement.classList.remove('hidden')

	let names = '', i18nKey = ''
	if (typingChars.size > 4) {
		i18nKey = 'chat.typingIndicator.multipleMembers'
		names = ''
	}
	else {
		i18nKey = 'chat.typingIndicator.isTyping'
		const charNames = await Promise.all(
			Array.from(typingChars).map(async (charname) => {
				try {
					const details = await getPartDetails(`chars/${charname}`)
					return details.info.name
				} catch (e) {
					return charname // fallback to id
				}
			})
		)
		names = charNames.join('、')
	}

	typingIndicatorElement.innerHTML = `\
<span class="loading loading-dots loading-xs"></span>
<span data-i18n="${i18nKey}" data-names="${names}"></span>
`
}

/**
 * 处理输入状态列表更新
 * @param {string[]} list - 正在输入的角色列表
 */
export function handleTypingStatus(list) {
	typingChars = new Set(list)
	updateTypingIndicator()
}
