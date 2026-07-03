/**
 * 主观信誉公共 barrel：标量运算（reputation_math）、持久化与副作用（reputation_store）、Social 阈值（reputation_social）。
 * 仿真与纯算子见 reputation_engine.mjs；按场景 pick 见 reputation_pick_score.mjs。
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
} from './reputation_store.mjs'

export {
	SOCIAL_BLOCK_CLAIM,
	SOCIAL_REP_HIDE_THRESHOLD,
	SOCIAL_REP_DEMOTE_THRESHOLD,
	shouldHideAuthorByReputation,
	reputationSortPenalty,
} from './reputation_social.mjs'
