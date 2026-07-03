/** 测试进程标记：须在导入 server/i18n 之前 side-effect import。 */
import process from 'node:process'

import { unset_shutdown_listener } from 'npm:on-shutdown'

process.env.FOUNT_TEST ??= '1'

for (const event of ['uncaughtException', 'unhandledRejection', 'error']) {
	unset_shutdown_listener(event)
	process.on(event, err => console.error(`${event}:`, err))
}
