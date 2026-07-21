/** Playwright 可读常量（无 npm: 导入，供 Node 加载 fixtures）。 */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'

/** bootstrap / live 烟测共用的可发现占位 entityHash。 */
export const SEEDED_TEST_TARGET_HASH = placeholderEntityHash('a')

/** 联邦 ingest 的远程作者 entityHash（与 seedForeignFeedAuthor.mjs 一致）。 */
export const FOREIGN_FE_AUTHOR_HASH =
	'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbd4e02f43853c45ca08a9ca2cbe399445861f4927d10b0861cce33c6f2fd4645'

/** bootstrap 写入的公开帖正文前缀（Playwright 定位用）。 */
export const FOREIGN_FE_POST_MARKER = 'fe-foreign-governance-post'
