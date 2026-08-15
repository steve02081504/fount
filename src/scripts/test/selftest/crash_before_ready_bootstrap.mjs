/**
 * worker 在 boot 完成前退出，模拟就绪 JSON 之前崩溃。
 */
import process from 'node:process'

/**
 * @returns {void}
 */
export default function crashBeforeReady() {
	process.exit(1)
}
