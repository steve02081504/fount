import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * fount 仓库根目录绝对路径。
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
