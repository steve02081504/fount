import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs'

export async function formatStr(str, data) {
	// 使用循环匹配所有 ${...} 表达式
	let result = ''
	while (str.indexOf('${') != -1) {
		const length = str.indexOf('${')
		result += str.slice(0, length)
		str = str.slice(length + 2)
		let end_index = 0
		find: while (str.indexOf('}', end_index) != -1) { // 我们需要遍历所有的结束符直到表达式跑通
			end_index = str.indexOf('}', end_index) + 1
			const expression = str.slice(0, end_index - 1)
			try {
				const eval_result = await async_eval(expression, data)
				if (eval_result.error) throw eval_result.error
				result += eval_result.result
				str = str.slice(end_index)
				break find
			} catch (error) { }
		}
	}
	result += str
	return result
}
