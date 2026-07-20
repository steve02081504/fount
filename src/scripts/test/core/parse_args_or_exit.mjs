import process from 'node:process'
import { parseArgs } from 'node:util'

/**
 * 仅拦截参数解析错误；其他异常仍应继续抛出。
 * @param {unknown} error 捕获到的异常
 * @returns {boolean} 是否为 parseArgs 已知用户输入错误
 */
function isParseArgsError(error) {
	return String(error?.code ?? '').startsWith('ERR_PARSE_ARGS_')
}

/**
 * 解析 CLI 参数；对用户输入错误直接打印并以 code 2 退出。
 * @param {Parameters<typeof parseArgs>[0]} options parseArgs 配置
 * @returns {ReturnType<typeof parseArgs>} 解析结果
 */
export function parseArgsOrExit(options) {
	try {
		return parseArgs(options)
	}
	catch (error) {
		if (!isParseArgsError(error)) throw error
		console.error(error.message ?? String(error))
		process.exit(2)
	}
}
