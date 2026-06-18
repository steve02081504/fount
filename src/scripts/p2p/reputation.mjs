/** 主观信誉标量运算（§0.3、§0.1）；持久化由 chat shell 的 `reputation.mjs` 负责。 */

export {
	REP_MIN,
	REP_MAX,
	REP_MAX_EFF_EPS,
	clampReputationScore,
	computeRepMaxEff,
	subjectiveSlashPenalty,
	seedReputationFromIntro,
} from './reputation_math.mjs'

/** 信誉持久化与具体更新算子（节点目录，全局单分）；纯标量运算见上方。 */
export {
	loadReputation,
	saveReputation,
	pickNodeScore,
	bumpReputationOnRelay,
	recordGossipAllUnknownWant,
	recordMessageRateViolation,
	bumpChunkStorageReputation,
	penalizeChunkStorageFailure,
	penalizeArchiveServeMismatch,
	resolveSlashAlertTtlMs,
	applyVolatileSlashAlert,
	buildAndApplyUnverifiedSlashAlert,
	applySubjectiveSlashFromEvent,
	applyDecayCollusionAfterSlash,
	applyReputationResetToScores,
	seedMemberReputationFromIntroducer,
	relayBumpIsDuplicate,
} from './reputation_store.mjs'
