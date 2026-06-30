/**
 * 聚合各模块 tunables（运行时默认值 + 挖矿候选）。
 */
import admissionTunables from '../admission.tunables.json' with { type: 'json' }
import archiveTunables from '../archive.tunables.json' with { type: 'json' }
import mailboxTunables from '../mailbox/mailbox.tunables.json' with { type: 'json' }
import reputationTunables from '../reputation.tunables.json' with { type: 'json' }
import socialTunables from '../reputation_social.tunables.json' with { type: 'json' }
import trustGraphTunables from '../trust_graph.tunables.json' with { type: 'json' }

/**
 * @typedef {{
 *   reputation: typeof reputationTunables,
 *   trustGraph: typeof trustGraphTunables,
 *   social: typeof socialTunables,
 *   mailbox: typeof mailboxTunables,
 *   archive: typeof archiveTunables,
 *   admission: typeof admissionTunables,
 * }} TunablesBundle
 */

/** @type {Readonly<Record<keyof TunablesBundle, string>>} */
export const TUNABLES_PATHS = Object.freeze({
	reputation: new URL('../reputation.tunables.json', import.meta.url).pathname.replace(/\\/g, '/'),
	trustGraph: new URL('../trust_graph.tunables.json', import.meta.url).pathname.replace(/\\/g, '/'),
	social: new URL('../reputation_social.tunables.json', import.meta.url).pathname.replace(/\\/g, '/'),
	mailbox: new URL('../mailbox/mailbox.tunables.json', import.meta.url).pathname.replace(/\\/g, '/'),
	archive: new URL('../archive.tunables.json', import.meta.url).pathname.replace(/\\/g, '/'),
	admission: new URL('../admission.tunables.json', import.meta.url).pathname.replace(/\\/g, '/'),
})

/** 只读默认模板（模块加载时构建一次） */
const DEFAULT_TUNABLES_TEMPLATE = Object.freeze({
	reputation: structuredClone(reputationTunables),
	trustGraph: structuredClone(trustGraphTunables),
	social: structuredClone(socialTunables),
	mailbox: structuredClone(mailboxTunables),
	archive: structuredClone(archiveTunables),
	admission: structuredClone(admissionTunables),
})

/**
 * @returns {TunablesBundle} 当前默认 tunables 深拷贝
 */
export function loadDefaultTunables() {
	return {
		reputation: structuredClone(DEFAULT_TUNABLES_TEMPLATE.reputation),
		trustGraph: structuredClone(DEFAULT_TUNABLES_TEMPLATE.trustGraph),
		social: structuredClone(DEFAULT_TUNABLES_TEMPLATE.social),
		mailbox: structuredClone(DEFAULT_TUNABLES_TEMPLATE.mailbox),
		archive: structuredClone(DEFAULT_TUNABLES_TEMPLATE.archive),
		admission: structuredClone(DEFAULT_TUNABLES_TEMPLATE.admission),
	}
}

/**
 * @param {Partial<TunablesBundle>} patch 局部覆盖
 * @returns {TunablesBundle} 合并后的 tunables
 */
export function mergeTunables(patch = {}) {
	const base = loadDefaultTunables()
	return {
		reputation: { ...base.reputation, ...patch.reputation },
		trustGraph: { ...base.trustGraph, ...patch.trustGraph },
		social: { ...base.social, ...patch.social },
		mailbox: { ...base.mailbox, ...patch.mailbox },
		archive: { ...base.archive, ...patch.archive },
		admission: { ...base.admission, ...patch.admission },
	}
}
