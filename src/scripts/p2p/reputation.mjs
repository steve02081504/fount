/** 主观信誉标量运算（§0.3、§0.1）；持久化于节点目录 reputation.json。 */

/**
 *
 */
export {
	REP_MIN,
	REP_MAX,
	REP_MAX_EFF_EPS,
	clampReputationScore,
	computeRepMaxEff,
	subjectiveSlashPenalty,
	seedReputationFromIntro,
} from './reputation_math.mjs'

/**
 *
 */
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
	applySocialBlockReputationSignal,
	applySocialSuspectReputationSignal,
} from './reputation_store.mjs'

/**
 *
 */
export {
	SOCIAL_BLOCK_CLAIM,
	SOCIAL_REP_HIDE_THRESHOLD,
	SOCIAL_REP_DEMOTE_THRESHOLD,
	applySocialBlockDecayAll,
	shouldHideAuthorByReputation,
	reputationSortPenalty,
} from './reputation_social.mjs'
