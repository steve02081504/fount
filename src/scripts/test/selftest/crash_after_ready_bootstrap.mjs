import process from 'node:process'

/**
 * boot 返回后立刻退出，模拟已打 ready JSON 但 ping 未完成。
 * @returns {void}
 */
export default function crashAfterReady() {
	setTimeout(() => process.exit(1), 0)
}
