import { geti18n, setLocalizeLogic } from '../../../../../scripts/i18n.mjs'
import { getCharDetails } from '../../../../scripts/parts.mjs'

const typingIndicatorElement = document.getElementById('typing-indicator')
let typingChars = new Set()

/**
 * 更新正在输入的指示器
 */
async function updateTypingIndicator() {
	if (typingChars.size === 0) {
		typingIndicatorElement.classList.add('hidden')
		typingIndicatorElement.innerHTML = ''
		return
	}

	typingIndicatorElement.classList.remove('hidden')

	const charNames = await Promise.all(
		Array.from(typingChars).map(async (charname) => {
			try {
				const details = await getCharDetails(charname)
				return details.info.name
			} catch (e) {
				return charname // fallback to id
			}
		})
	)

	setLocalizeLogic(typingIndicatorElement, () => {
		let text
		if (charNames.length > 4) text = geti18n('chat.typingIndicator.multipleMembers')
		else {
			const names = charNames.join('、')
			text = geti18n('chat.typingIndicator.isTyping', { names })
		}

		typingIndicatorElement.innerHTML = `\
<span class="loading loading-dots loading-xs"></span>
<span>${text}</span>
`
	})
}

/**
 * 处理输入状态列表更新
 * @param {string[]} list - 正在输入的角色列表
 */
export function handleTypingStatus(list) {
	typingChars = new Set(list)
	updateTypingIndicator()
}
