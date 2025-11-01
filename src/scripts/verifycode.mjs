import cryptoRandomString from 'npm:crypto-random-string'

import { console, geti18n } from '../scripts/i18n.mjs'

import { ms } from './ms.mjs'
import { notify } from './notify.mjs'

// 用于存储验证码、过期时间和ID
let verificationCodes = []

// 验证码过期时间 (60秒)
const CODE_EXPIRATION_TIME = ms('60s')

/**
 * 生成验证码的函数
 * @param {string} id - 与验证码关联的用户或会话的唯一标识符。
 */
export async function generateVerificationCode(id) {
	// 清除过期的验证码
	verificationCodes = verificationCodes.filter(code => code.expiresAt > Date.now())
	// 若该ID已经存在，返回
	if (verificationCodes.some(code => code.id === id)) return
	const code = cryptoRandomString({ length: 6, type: 'alphanumeric' })
	const expiresAt = Date.now() + CODE_EXPIRATION_TIME

	// 将验证码、过期时间和ID添加到数组
	verificationCodes.push({ code, expiresAt, id })

	console.logI18n('fountConsole.verification.codeGeneratedLog', { code })
	notify(geti18n('fountConsole.verification.codeNotifyTitle'), geti18n('fountConsole.verification.codeNotifyBody', { code }))
}

/**
 * 验证验证码的函数
 * @param {string} code - 用户输入的验证码
 * @param {string} id - 用户ID
 * @returns {boolean} - 验证码是否有效
 */
export function verifyVerificationCode(code, id) {
	return verificationCodes.some(codeObj => codeObj.code === code && codeObj.id === id && codeObj.expiresAt > Date.now())
}
