import sha256 from 'npm:crypto-js/sha256.js'
import droll from 'npm:droll'
import moment from 'npm:moment/moment.js'
import seedrandom from 'npm:seedrandom'

/**
 * 字符串哈希
 * @returns {string}
 * @param {string} str 字符串
 */
const STRING_HASH = str => sha256(str).toString()

/**
 * 获取变量
 * @returns {any}
 * @param {any} memory 内存
 * @param {any} name 名称
 * @param {any} args 参数
 * @param {any} isGlobal 是否全局
 */
function getVariable(memory, name, args = {}, isGlobal = false) {
	const storage = isGlobal ? memory?.globalVariables : memory?.variables
	if (!storage) return ''
	let variable = storage[args.key || name]
	if (args.index !== undefined) try {
		variable = JSON.parse(variable)
		variable = variable?.[args.index]
		if (variable instanceof Object) variable = JSON.stringify(variable)
	} catch { }

	return variable === '' || isNaN(Number(variable)) ? variable || '' : Number(variable)
}

/**
 * 设置变量
 * @returns {any}
 * @param {any} memory 内存
 * @param {any} name 名称
 * @param {any} value 值
 * @param {any} args 参数
 * @param {any} isGlobal 是否全局
 */
function setVariable(memory, name, value, args = {}, isGlobal = false) {
	const storage = isGlobal ? memory.globalVariables ??= {} : memory.variables ??= {}
	if (args.index !== undefined) try {
		let current = JSON.parse(storage[name] ?? 'null')
		if (current === null) current = Number.isNaN(Number(args.index)) ? {} : []
		current[args.index] = value
		storage[name] = JSON.stringify(current)
		return value
	} catch { }

	return storage[name] = value
}

/**
 * 修改变量
 * @returns {any}
 * @param {any} memory 内存
 * @param {any} name 名称
 * @param {any} value 值
 * @param {boolean} isGlobal 是否全局
 * @param {string} operation 操作
 */
function modifyVariable(memory, name, value, isGlobal = false, operation = 'add') {
	const currentValue = getVariable(memory, name, {}, isGlobal) || 0
	let newValue

	try {
		const parsedValue = JSON.parse(currentValue)
		if (Array.isArray(parsedValue)) {
			parsedValue.push(value)
			return setVariable(memory, name, JSON.stringify(parsedValue), {}, isGlobal)
		}
	} catch { }

	const increment = Number(value)

	if (isNaN(increment) || isNaN(Number(currentValue)))
		newValue = String(currentValue || '') + value
	else {
		newValue = Number(currentValue) + (operation === 'add' ? increment : -increment)
		if (isNaN(newValue)) return ''
	}

	return setVariable(memory, name, newValue, {}, isGlobal)
}


/**
 * 替换变量宏
 * @returns {any}
 * @param {any} input 输入
 * @param {any} memory 内存
 */
function replaceVariableMacros(input, memory) {
	if (!input || !input.includes('{{')) return input

	return input.split('\n').map(line => {
		if (!line || !line.includes('{{')) return line

		line = line.replace(/{{(getvar|getglobalvar)::([^}]+)}}/gi, (_, type, name) => {
			name = name.trim()
			return getVariable(memory, name, {}, type === 'getglobalvar')
		})

		line = line.replace(/{{(setvar|setglobalvar)::([^:]+)::([^}]+)}}/gi, (_, type, name, value) => {
			name = name.trim()
			setVariable(memory, name, value, {}, type === 'setglobalvar')
			return ''
		})

		line = line.replace(/{{(addvar|addglobalvar)::([^:]+)::([^}]+)}}/gi, (_, type, name, value) => {
			name = name.trim()
			modifyVariable(memory, name, value, type === 'addglobalvar', 'add')
			return ''
		})

		line = line.replace(/{{(incvar|incglobalvar)::([^}]+)}}/gi, (_, type, name) => {
			name = name.trim()
			return modifyVariable(memory, name, 1, type === 'incglobalvar', 'add')
		})

		line = line.replace(/{{(decvar|decglobalvar)::([^}]+)}}/gi, (_, type, name) => {
			name = name.trim()
			return modifyVariable(memory, name, 1, type === 'decglobalvar', 'sub')
		})

		return line
	}).join('\n')
}



/**
 * 获取自上次消息以来的时间
 * @returns {string}
 * @param {any} chatLog 聊天记录
 */
function getTimeSinceLastMessage(chatLog) {
	if (!chatLog?.length) return 'just now'
	const lastMessage = chatLog
		.filter(message => message.role !== 'system')
		.toReversed()
		.find((_, index, arr) => arr[index + 1]?.role === 'user')
	if (lastMessage?.time_stamp)
		return moment.duration(moment().diff(lastMessage.time_stamp)).humanize()

	return 'just now'
}

/**
 * 随机替换
 * @returns {any}
 * @param {any} input 输入
 * @param {any} emptyListPlaceholder 空列表占位符
 */
function randomReplace(input, emptyListPlaceholder = '') {
	return input.replace(/{{random\s?::?([^]*?)}}/gi, (_, listString) => {
		const list = listString.split(/(?<!\\),/g).map(item => item.replace(/\\,/g, ',').trim())
		if (!list.length) return emptyListPlaceholder
		const randomIndex = Math.floor(seedrandom('added entropy.', { entropy: true })() * list.length)
		return list[randomIndex]
	})
}

/**
 * 挑选替换
 * @returns {any}
 * @param {any} input 输入
 * @param {any} rawContent 原始内容
 * @param {any} emptyListPlaceholder 空列表占位符
 */
function pickReplace(input, rawContent, emptyListPlaceholder = '') {
	return input.replace(/{{pick\s?::?([^]*?)}}/gi, (_, listString, offset) => {
		const list = listString.split(/(?<!\\),/g).map(item => item.replace(/\\,/g, ',').trim())
		if (!list.length) return emptyListPlaceholder
		const randomIndex = Math.floor(seedrandom(STRING_HASH(`${STRING_HASH(rawContent)}-${offset}`))() * list.length)
		return list[randomIndex]
	})
}

/**
 * 掷骰子替换
 * @returns {any}
 * @param {any} input 输入
 * @param {any} invalidRollPlaceholder 无效掷骰占位符
 */
function diceRollReplace(input, invalidRollPlaceholder = '') {
	return input.replace(/{{roll[ :]([^}]+)}}/gi, (_, formula) => {
		formula = formula.trim()
		if (/^\d+$/.test(formula)) formula = `1d${formula}`
		return droll.validate(formula) ? String(droll.roll(formula).total) : invalidRollPlaceholder
	})
}

/**
 * 时间差替换
 * @returns {any}
 * @param {any} input 输入
 */
function timeDiffReplace(input) {
	return input.replace(/{{timediff::(.*?)::(.*?)}}/gi, (_, time1, time2) =>
		moment.duration(moment(time1).diff(moment(time2))).humanize()
	)
}

/**
 * 违禁词替换
 * @returns {any}
 * @param {any} inText 输入文本
 */
function bannedWordsReplace(inText) {
	return inText ? inText.replaceAll(/{{banned "(.*)"}}/gi, '') : ''
}

/**
 * 评估宏
 * @returns {string}
 * @param {string} content 内容
 * @param {any} env 环境
 * @param {any} memory 内存
 * @param {any} chatLog 聊天记录
 */
export function evaluateMacros(content, env, memory = {}, chatLog = []) {
	if (!content) return ''
	const rawContent = content

	content = content
		.replace(/<user>/gi, env.user instanceof Function ? env.user() : env.user)
		.replace(/<bot>|<char>/gi, env.char instanceof Function ? env.char() : env.char)
		.replace(/<charifnotgroup>|<group>/gi, env.group instanceof Function ? env.group() : env.group)

	if (!content.includes('{{')) return content

	content = content.replace(/{{reverse::(.*?)}}/gi, (_, str) => str.split('').reverse().join(''))

	content = diceRollReplace(content)
	content = replaceVariableMacros(content, memory)
	content = content.replace(/{{newline}}/gi, '\n')
	content = content.replace(/\n*{{trim}}\n*/gi, '')
	content = content.replace(/{{noop}}/gi, '')


	for (const varName in env)
		if (Object.hasOwn(env, varName))
			content = content.replace(new RegExp(`{{${varName}}}`, 'gi'), env[varName])



	content = content.replace(/{{\/\/([\S\s]*?)}}/gm, '')
	content = content.replace(/{{lasttime}}/gi, () => {
		const lastMessage = chatLog?.findLast(message => message.role !== 'system')
		return lastMessage?.time_stamp ? moment(lastMessage.time_stamp).format('LT') : ''
	})
	content = content.replace(/{{lastdate}}/gi, () => {
		const lastMessage = chatLog?.findLast(message => message.role !== 'system')
		return lastMessage?.time_stamp ? moment(lastMessage.time_stamp).format('LL') : ''
	})
	content = content.replace(/{{time}}/gi, () => moment().format('LT'))
	content = content.replace(/{{date}}/gi, () => moment().format('LL'))
	content = content.replace(/{{weekday}}/gi, () => moment().format('dddd'))
	content = content.replace(/{{isotime}}/gi, () => moment().format('HH:mm'))
	content = content.replace(/{{isodate}}/gi, () => moment().format('YYYY-MM-DD'))
	content = content.replace(/{{datetimeformat +([^}]*)}}/gi, (_, format) => moment().format(format))
	content = content.replace(/{{idle_duration}}/gi, () => getTimeSinceLastMessage(chatLog))
	content = content.replace(/{{time_utc([+-]\d+)}}/gi, (_, offset) => moment().utc().utcOffset(parseInt(offset, 10)).format('LT'))

	content = timeDiffReplace(content)
	content = bannedWordsReplace(content)
	content = randomReplace(content)
	content = pickReplace(content, rawContent)
	content = replaceVariableMacros(content, memory)

	return content
}
