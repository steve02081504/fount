import process from 'node:process'

import { console } from 'npm:@steve02081504/virtual-console'

/** Node 默认虚拟控制台（全局代理）。 */
export const defaultConsole = console
/** Node 默认 stdin（`process.stdin`）。 */
export const defaultStdin = process.stdin
/** Node 默认 stdout（`console._stdout`）。 */
export const defaultStdout = console._stdout
