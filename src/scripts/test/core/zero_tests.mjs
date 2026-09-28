/**
 * 检测一次 deno test 运行是否「注册了 0 个测试」却以 0 退出。
 *
 * 静态 import 失败（如并发 node_modules 竞态）会让文件注册 0 个测试并正常退出，
 * 绿行掩盖了整文件从未运行。被 FOUNT_TEST_ONLY / 子测试过滤掉的运行会打印
 * `filtered out` / `ignored`，必须放行，勿误报。
 */
import { removeTerminalSequences } from 'npm:@steve02081504/exec'

/**
 * 运行输出是否「未跑任何测试且未被过滤」。
 * @param {string} output 子进程 stdall
 * @returns {boolean} 是否应判为 0 测试失败
 */
export function detectsZeroTests(output) {
	const plain = removeTerminalSequences(output)
	return /running 0 tests\b/.test(plain)
		&& !/filtered out/.test(plain)
		&& !/\bignored\b/.test(plain)
}
