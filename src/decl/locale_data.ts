// 此文件由本地化文件自动生成。
// 请勿手动编辑此文件，因为它将被覆盖。
// 此文件为 i18n 键提供类型定义，实现自动补全。

/**
 * 表示所有可能的语言环境数据类型。
 */
export type LocaleData = {
	lang: string
	name: string
	channels: {
		title: string
		description: string
		create: string
		subscribe: string
		unsubscribe: string
		settings: string
		list: string
		members: string
		messages: string
		permissions: string
		type: {
			announcement: string
			news: string
			updates: string
		}
		role: {
			owner: string
			admin: string
			moderator: string
			member: string
			subscriber: string
		}
		errors: {
			notFound: string
			noPermission: string
			alreadySubscribed: string
			notSubscribed: string
		}
		success: {
			created: string
			updated: string
			deleted: string
			subscribed: string
			unsubscribed: string
			posted: string
		}
	}
	profile: {
		title: string
		description: string
		settingsEyebrow: string
		accountAtGlance: string
		advancedKicker: string
		advancedSettings: string
		advancedDescription: string
		edit: string
		save: string
		cancel: string
		displayName: string
		name: string
		bio: string
		descriptionLabel: string
		email: string
		status: string
		customStatusLabel: string
		avatarLabel: string
		themeColorLabel: string
		uploadAvatar: string
		ownerTitle: string
		ownerSummary: string
		ownerDescription: string
		ownerEntityHashLabel: string
		ownerSave: string
		ownerClear: string
		ownerSaved: string
		ownerCleared: string
		ownerSaveFailed: string
		ownerConfirmTitle: string
		ownerConfirmWarningTitle: string
		ownerConfirmEditBody: string
		ownerConfirmRenderBody: string
		ownerConfirmCooldown: string
		ownerConfirmFirst: string
		ownerConfirmSecond: string
		ownerConfirmCancel: string
		federationTitle: string
		federationSummary: string
		federationDescription: string
		federationAdvanced: string
		federationRelayUrlsLabel: string
		federationBatterySaverLabel: string
		federationSave: string
		federationResetDefault: string
		federationSaved: string
		federationResetOk: string
		federationSaveFailed: string
		preferences: string
		language: string
		theme: string
		notifications: string
		emailNotifications: string
		pushNotifications: string
		soundNotifications: string
		social: string
		website: string
		github: string
		twitter: string
		stats: string
		joinedAt: string
		messageCount: string
		groupCount: string
		channelCount: string
		privacy: string
		showEmail: string
		showStats: string
		allowDirectMessages: string
		statusOptions: {
			online: string
			away: string
			busy: string
			offline: string
		}
		themeOptions: {
			auto: string
			light: string
			dark: string
		}
		languageOptions: {
			'zh-CN': string
			'en-US': string
		}
		notifEmail: string
		notifPush: string
		notifSound: string
		notifsAllOff: string
		bioEmpty: string
		noSocialLinks: string
		emailVisible: string
		emailHidden: string
		customStatus: {
			placeholder: string
		}
		avatar: {
			alt: string
		}
		avatarPreview: {
			alt: string
		}
		myGroups: string
		myChannels: string
		noGroups: string
		noChannels: string
		overview: string
		summaryUserId: string
		summaryAccountStatus: string
		summaryEmailVisibility: string
		summaryThemePref: string
		summaryLanguagePref: string
		summarySocialCount: string
		summaryLinksCount: string
		groupDescriptionEmpty: string
		groupMembers: string
		channelPrivate: string
		channelTypeText: string
		channelTypeList: string
		channelTypeVoice: string
		channelTypeStreaming: string
		errors: {
			loadFailed: string
			saveFailed: string
			uploadFailed: string
			invalidUserData: string
			identityRequired: string
			fetchUserFailed: string
			operationFailed: string
		}
		success: {
			saved: string
			avatarUploaded: string
		}
		ownerEntityHash: {
			placeholder: string
		}
	}
	stickers: {
		title: string
		description: string
		back: {
			title: string
		}
		packs: string
		create: string
		upload: string
		install: string
		uninstall: string
		close: string
		cancel: string
		installed: string
		myPacks: string
		tabAll: string
		store: string
		favorites: string
		recent: string
		search: {
			placeholder: string
		}
		emptyPacks: string
		packNameLabel: string
		packName: {
			placeholder: string
		}
		packDescriptionLabel: string
		packDescription: {
			placeholder: string
		}
		stickerNameLabel: string
		stickerName: {
			placeholder: string
		}
		selectPack: string
		selectPackOption: {
			textContent: string
		}
		selectImage: string
		tagsLabel: string
		tags: {
			placeholder: string
		}
		author: string
		authorLabel: string
		stickerCount: string
		badgeMine: string
		noDescription: string
		noStickersInPack: string
		deletePack: string
		public: string
		private: string
		animated: string
		static: string
		addTag: string
		defaultPackName: string
		defaultPackDescription: string
		unnamedPack: string
		importPackName: string
		importPackDescription: string
		nameRequired: string
		stickerNameRequired: string
		selectPackRequired: string
		fileRequired: string
		loadDetailFailed: string
		deleteConfirm: string
		errors: {
			loadFailed: string
			uploadFailed: string
			installFailed: string
			uninstallFailed: string
			createFailed: string
			deleteFailed: string
		}
		success: {
			uploaded: string
			installed: string
			uninstalled: string
			created: string
			deleted: string
		}
	}
	fountConsole: {
		server: {
			start: string
			starting: string
			ready: string
			standingBy: string
			showUrl: {
				https: string
				http: string
			}
			mdns: {
				description: string
				failed: string
				bonjourFailed: string
			}
			localUrl: string
			update: {
				restarting: string
			}
		}
		jobs: {
			restartingJob: string
			pausingJob: string
			preloadingParts: string
		}
		ipc: {
			serverStarted: string
			instanceRunning: string
			noInstanceRunning: string
			runPartLog: string
			invokePartLog: string
			invalidCommand: string
			invalidCommandFormat: string
			unsupportedCommand: string
			processMessageError: string
			sendCommandFailed: string
			socketError: string
			parseResponseFailed: string
			cannotParseResponse: string
			unknownError: string
			partPathRequired: string
		}
		partManager: {
			partInited: string
			partLoaded: string
			git: {
				updating: string
				upToDate: string
				localAhead: string
				noUpstream: string
				dirtyWorkingDirectory: string
				uncommittedBackedUpTo: string
				diverged: string
				updateFailed: string
			}
		}
		web: {
			requestReceived: string
			frontendFilesChanged: string
		}
		route: {
			setLanguagePreference: string
		}
		auth: {
			accountLockedLog: string
			tokenVerifyError: string
			refreshTokenError: string
			logoutRefreshTokenProcessError: string
			revokeTokenNoJTI: string
		}
		verification: {
			codeGeneratedLog: string
			codeNotifyTitle: string
			codeNotifyBody: string
		}
		tray: {
			title: string
			tooltip: string
			readIconFailed: string
			createTrayFailed: string
			items: {
				open: {
					title: string
					tooltip: string
				}
				github: {
					title: string
					tooltip: string
				}
				telegram: {
					title: string
					tooltip: string
				}
				restart: {
					title: string
					tooltip: string
				}
				exit: {
					title: string
					tooltip: string
				}
				clearTerminalScreen: {
					title: string
					tooltip: string
				}
				openTerminal: {
					title: string
					tooltip: string
				}
			}
		}
		botStarted: string
		logViewer: {
			replHint: string
		}
		test: {
			help: string
			passed: string
			passedWithNoise: string
			failed: string
			failedWithCode: string
			passedLabel: string
			failedLabel: string
			noiseHits: string
			unknownManifestId: string
			unknownSuiteSelector: string
			unknownSubtestFilter: string
			unknownFileFilter: string
			unsupportedSubtestFilter: string
			available: string
			manifestMatched: string
			selectedSuites: string
			planSlotSummary: string
			noMatchingSuites: string
			reportPath: string
			reportPathFinal: string
			statePathFinal: string
			blocked: string
			speculativeDiscard: string
			continueImperfect: string
			outdatedSelected: string
			runningSuite: {
				base: string
				speculative: string
				heavy: string
				expected: string
			}
			reusedSuite: string
			noisyOnlyRemain: string
			estimatedRun: string
			estimatedRunSerial: string
			estimatedRunSkipped: string
			noRealRunPlanned: string
			allReusedHint: string
			estimatedRemaining: string
			estimatedRunSerialHint: string
			failuresSaved: string
			failuresCleared: string
			terminated: string
			terminateIdle: string
			terminateDuration: string
			terminateDurationDefault: string
			terminateMarker: string
			terminateUnknown: string
			terminateSpeculative: string
			nothingToContinue: string
			triggerNoMatch: string
			triggerNoMatchSummary: string
			unknownSuite: string
			federationCleanupPre: string
			federationCleanupPost: string
			suiteHeader: string
			heapSnapshotSaved: string
			liveUsage: string
			serialUsage: string
			silentPassedOne: string
			silentPassedMany: string
			ciNoDiffFallback: string
			noFrontendPhasesMatched: string
			denoPanic: {
				detected: string
				alreadyReported: string
				ghUnavailable: string
				published: string
				duplicate: string
				publishFailed: string
			}
			nodeWorker: {
				dataPathRequired: string
				portRequired: string
				keyRequired: string
				userRequired: string
				error: string
			}
			ws: {
				pass: string
				fail: string
			}
			report: {
				title: string
				tableHeaderItem: string
				tableHeaderValue: string
				fieldRunId: string
				fieldCommand: string
				fieldExit: string
				fieldProgress: string
				fieldSuites: string
				fieldFailed: string
				fieldNoisyPassed: string
				fieldReused: string
				fieldSuiteSumDuration: string
				fieldWallClock: string
				fieldParallelRate: string
				fieldEstimatedRemaining: string
				fieldEstimatedParallelRate: string
				estimatePoint: string
				pendingEstimate: string
				pendingParallelEstimate: string
				pendingSavings: string
				pendingItemExpected: string
				fieldDuration: string
				commandDefault: string
				exitPassed: string
				exitFailed: string
				exitInProgress: string
				progressFormat: string
				suitesFormat: string
				artifacts: string
				sectionFailed: string
				sectionNoisyPassed: string
				sectionSilentPassed: string
				sectionPending: string
				sectionContinue: string
				sectionReplay: string
				sectionReplayImperfect: string
				columnSuite: string
				columnDuration: string
				labelReused: string
				labelExpectedBlocked: string
				labelDuration: string
				labelLog: string
				labelNoise: string
				labelFailedFiles: string
				labelTerminateReason: string
				sectionContinueReasons: string
				continueReasonsLink: string
				labelContinueReason: string
				reasonImperfectFailed: string
				reasonImperfectNoisy: string
				reasonImperfectBlocked: string
				reasonImperfectDependent: string
				reasonMissingRecord: string
				reasonStaleContent: string
				reasonTriggerHashDrift: string
				reasonExplicitSelected: string
				reasonDependencyRequired: string
				labelRootCause: string
				labelDirectRequiredBy: string
				labelInclusionPath: string
				labelPullUpstream: string
				labelPullDownstream: string
				labelGateReason: string
				labelCommitRange: string
				labelUncommittedHashRange: string
				labelMatchedTriggers: string
				labelMatchedTriggerSets: string
				labelMatchedPaths: string
				labelTriggerHashDrift: string
				sectionDeadTriggers: string
				deadTriggersHint: string
				durationMs: string
				durationUnitSec: string
				durationUnitMin: string
				durationUnitMinute: string
				durationUnitHour: string
				durationUnitDay: string
			}
			state: {
				title: string
				artifacts: string
				sectionDependencyTree: string
				sectionOverview: string
				sectionBlocked: string
				columnSuite: string
				columnStatus: string
				columnCommit: string
				columnRanAt: string
				columnDuration: string
				columnLog: string
				columnBlocked: string
				labelBlockedBy: string
				statusUnknown: string
				statusOutdated: string
			}
		}
		path: {
			protocol: {
				description: string
				registerFailed: string
				noUrl: string
			}
			update: {
				skippingFountUpdate: string
			}
			shortcut: {
				desktopShortcutCreated: string
				startMenuShortcutCreated: string
				protocolHandlerRegistered: string
				shortcutNotSupported: string
				osacompileNotFound: string
				lsregisterFailed: string
				createDesktopAppFailed: string
			}
			git: {
				repoNotFound: string
				fetchingAndResetting: string
				localChangesDetected: string
				backupSavedTo: string
				updatingFromRemote: string
				alreadyUpToDate: string
				localBranchAhead: string
				branchesDiverged: string
				notOnBranch: string
				noUpstreamBranch: string
				dirtyWorkingDirectory: string
				notInstalled: string
				notInstalledSkippingPull: string
				repoNotFoundSkippingPull: string
				fetchFailed: string
				fetchFailedSkippingUpdate: string
				remoteRefUnavailable: string
				installFailedWinget: string
				installFailedManual: string
			}
			deno: {
				missing: string
				isRequired: string
				installingTermux: string
				installFailedFallback: string
				notWorking: string
				upgradeFailed: string
				upgradeFailedTermux: string
				patchMissing: string
				patchUnsupportedArch: string
				patchFailed: string
			}
			tempDir: {
				blocked: string
			}
			install: {
				installingDependencies: string
				packageFailed: string
				browserMissing: string
				untrustedPartsWarning: string
				rootWarning1: string
				rootWarning2: string
				permissionDeniedAsRoot: string
				permissionDeniedNotRoot: string
			}
			clean: {
				removingCaches: string
				cleaningDenoCaches: string
				cleaningOldPwshModules: string
			}
			keepalive: {
				initComplete: string
				autoInitDisabled: string
				restartingTooFast: string
				failedToStart: string
				initFailed: string
			}
			terminalKeybindings: {
				registered: string
				wtPatchFailed: string
				wtRemoved: string
				editorRemoved: string
			}
			remove: {
				removingDesktopShortcut: string
				removingTerminalKeybindings: string
				removingFount: string
				fountUninstallationComplete: string
				removingFountInstallationDir: string
				fountInstallationDirRemoved: string
				removingFountFromPath: string
				removingProtocolHandler: string
				protocolHandlerRemoved: string
				removeProtocolHandlerFailed: string
				removingFountFromGitSafeDir: string
				removingInstalledSystemPackages: string
				uninstallingDeno: string
				removeDenoFailed: string
				removingFountPwshFromProfile: string
				fountPwshRemovedFromProfile: string
				pwshProfileNotFound: string
				uninstallingFountPwsh: string
				uninstallFountPwshFailed: string
				removingTerminalProfile: string
				terminalProfileRemoved: string
				terminalProfileNotFound: string
				desktopShortcutRemoved: string
				desktopShortcutNotFound: string
				removingStartMenuShortcut: string
				startMenuShortcutRemoved: string
				startMenuShortcutNotFound: string
				removingInstalledPwshModules: string
				moduleRemoved: string
				removeModuleFailed: string
				uninstallingGit: string
				uninstallingChrome: string
				uninstallingWinget: string
				removingBackgroundRunner: string
				removeBackgroundRunnerFailed: string
			}
		}
	}
	installer_wait_screen: {
		title: string
		description: string
		hero: {
			title: string
			description: string
		}
		feature1: {
			title: string
			description: string
		}
		feature2: {
			title: string
			description: string
		}
		feature3: {
			title: string
			description: string
		}
		feature4: {
			title: string
			description: string
		}
		language_selector: {
			button: {
				'aria-label': string
			}
			search: {
				placeholder: string
			}
		}
		theme_selector: {
			title: string
			description: string
			search: {
				placeholder: string
			}
		}
		mini_game: {
			title: string
			description1: string
			description2: string
		}
		testimonials: {
			anonymous: string
			submit_link: string
		}
		data_showcase: {
			title_prefix: string
			title_of: string
			active_users: string
			stars: string
		}
		footer: {
			ready_text: string
			wait_text: string
			open_fount: string
			open_or_install_fount: string
			error_message: string
			star_thank_you: string
		}
		error: {
			title: string
			description: string
			connection_failed: string
			description1: string
			description2: string
			close_page: string
		}
	}
	protocolhandler: {
		title: string
		description: string
		processing: string
		invalidProtocol: string
		insufficientParams: string
		unknownCommand: string
		unknownError: string
		runPart: {
			commandSent: string
			commandError: string
			retry: string
			back: string
			confirm: {
				title: string
				message: string
				confirm: string
				cancel: string
			}
		}
		offline_dialog: {
			title: string
			message: string
			buttons: {
				start: string
				retry: string
			}
		}
		fountNotFound: string
	}
	startPage: {
		title: string
		description: string
	}
	tutorial: {
		title: string
		description: string
		modal: {
			title: string
			instruction: string
			buttons: {
				start: string
				skip: string
			}
		}
		endScreen: {
			title: string
			subtitle: string
			endButton: string
		}
		progressMessages: {
			mouseMove: string
			keyboardPress: string
			mobileTouchMove: string
			mobileClick: string
		}
		achievements: {
			complete_tutorial: {
				name: string
				description: string
				locked_description: string
			}
			skip_tutorial: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			other: {
				title: string
				sub_items: {
					replay: {
						title: string
					}
				}
			}
		}
	}
	auth: {
		title: string
		subtitle: string
		description: string
		usernameLabel: string
		usernameInput: {
			placeholder: string
		}
		passwordLabel: string
		passwordInput: {
			placeholder: string
		}
		confirmPasswordLabel: string
		confirmPasswordInput: {
			placeholder: string
		}
		verificationCodeLabel: string
		verificationCodeInput: {
			placeholder: string
		}
		sendCodeButton: string
		login: {
			title: string
			submitButton: string
			toggleLink: {
				textContent: string
				link: string
			}
		}
		register: {
			title: string
			submitButton: string
			toggleLink: {
				textContent: string
				link: string
			}
		}
		passwordStrength: {
			veryWeak: string
			weak: string
			normal: string
			strong: string
			veryStrong: string
		}
		error: {
			passwordMismatch: string
			loginError: string
			registrationError: string
			verificationCodeError: string
			verificationCodeSent: string
			verificationCodeSendError: string
			verificationCodeRateLimit: string
			lowPasswordStrength: string
			accountAlreadyExists: string
			powNotSolved: string
			powError: string
			invalidCredentials: string
			accountLockedRetry: string
			accountLockedAttempts: string
			powValidationFailed: string
			tokenAndSolutionsRequired: string
			apiErrorBodyUnreadable: string
		}
		webauthn: {
			loginButton: string
			errorLoadLibrary: string
			errorCancelled: string
			errorSessionMissing: string
			errorBadBeginResponse: string
			errorCredentialRequired: string
			errorAuthSessionRequired: string
			apiSessionExpired: string
			apiUnknownPasskey: string
			apiPasskeyVerificationFailed: string
			registrationUserNotFound: string
			registrationSessionExpired: string
			registrationVerifyFailed: string
			registrationFailed: string
			removeUserNotFound: string
			removeInvalidPassword: string
			removePasskeyNotFound: string
		}
	}
	login_info: {
		title: string
		description: string
		modal: {
			title: string
			retrieve_error: string
			transfer_error: string
			missing_params: string
			buttons: {
				ignore: string
				retry: string
			}
		}
	}
	home: {
		title: string
		description: string
		sidebarTitle: string
		itemDescription: string
		noDescription: string
		filterInput: {
			placeholder: string
			'aria-label': string
		}
		sfwToggle: string
		partTypeDropdown: {
			button: {
				title: string
			}
			icon: {
				alt: string
			}
		}
		functionMenu: {
			search: {
				placeholder: string
			}
			button: {
				title: string
			}
			icon: {
				alt: string
			}
		}
		emptyList: {
			message: string
		}
		part_pages: {
			default: {
				title: string
				subtitle: string
				card: {
					noTags: string
					version: string
					author: string
					home_page: string
					issue_page: string
					refreshButton: {
						alt: string
						title: string
					}
					defaultCheckbox: {
						title: string
					}
				}
			}
			chars: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			worlds: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			personas: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			plugins: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			ImportHandlers: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			serviceGenerators: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceGenerators/AI': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceGenerators/search': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceGenerators/translate': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			serviceSources: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceSources/AI': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceSources/search': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			'serviceSources/translate': {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			shells: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
		}
		escapeConfirm: string
		alerts: {
			fetchHomeRegistryFailed: string
		}
		achievements: {
			first_login: {
				name: string
				description: string
				locked_description: string
			}
			sfw_mode_on: {
				name: string
				description: string
				locked_description: string
			}
			sfw_mode_off: {
				name: string
				description: string
				locked_description: string
			}
			open_function_list: {
				name: string
				description: string
				locked_description: string
			}
			set_default_persona: {
				name: string
				description: string
				locked_description: string
			}
		}
		dragAndDrop: {
			dropSuccess: string
			dropError: string
			noHandler: string
		}
		home_common_interfaces: {
			open: {
				title: string
			}
		}
		home_drag_out_generators: {
			generateXFountPart: {
				description: string
			}
		}
	}
	social: {
		title: string
		description: string
		bootstrapFailed: string
		home_function_buttons: {
			main: {
				title: string
			}
		}
		nav: {
			feed: string
			explore: string
			notifications: string
			saved: string
			drafts: string
			profile: string
			videos: string
			live: string
		}
		settings: {
			title: string
			back: {
				'aria-label': string
			}
			privacyTitle: string
			privacyHint: string
			tasteTitle: string
			tasteHint: string
			mutedKeywordsTitle: string
			mutedKeywordsHint: string
			mutedKeywordsMatchTags: string
			mutedKeywordsAdd: string
			mutedKeywordsRemove: {
				title: string
			}
			mutedKeywordsEmpty: string
			autoTranslateTitle: string
			autoTranslateHint: string
			autoTranslateEnable: string
			safetyTitle: string
			safetyHint: string
			mutedKeywords: {
				placeholder: string
			}
		}
		composer: {
			placeholder: string
			publish: string
			saveDraft: string
			fab: {
				title: string
				'aria-label': string
			}
			contentWarning: {
				placeholder: string
			}
			sensitiveMedia: string
			editImage: string
			editCrop: string
			editMosaic: string
			editBrush: string
			editApply: string
			editCancel: string
			replyPolicyEveryone: string
			replyPolicyFollowers7d: string
			replyPolicyAuthorFollows: string
			replyPolicyLabel: string
			replyDisplayAll: string
			replyDisplayFeaturedOnly: string
			replyDisplayLabel: string
			scheduleLabel: string
			scheduleSuccess: string
			emojiButton: {
				title: string
				'aria-label': string
			}
			mediaButton: {
				title: string
				'aria-label': string
			}
			pollButton: {
				title: string
				'aria-label': string
			}
			cwToggle: {
				title: string
				'aria-label': string
			}
			advancedToggle: {
				title: string
				'aria-label': string
			}
			media: {
				placeholder: string
			}
		}
		visibility: {
			label: string
			public: string
			unlisted: string
			followers: string
			followers7d: string
			followers30d: string
			selected: string
			private: string
			allowLabel: string
			exceptLabel: string
			allow: {
				placeholder: string
			}
			except: {
				placeholder: string
			}
		}
		albums: {
			create: string
			edit: string
			save: string
			cancel: string
			back: string
			empty: string
			emptyPosts: string
			name: string
			description: string
			deleteLinks: string
			deleteWithPosts: string
			pickerLabel: string
			defaultName: string
		}
		feed: {
			refresh: string
			newPosts: string
			tabLatest: string
			tabForYou: string
			repostedBy: string
			decryptFailed: string
			revealContent: string
			sensitiveMedia: string
			showMore: string
			showLess: string
			replayDivider: string
		}
		taste: {
			rebuild: string
			privacyPublishPreferences: string
			privacyPublishPreferencesHint: string
			privacyPublishReactions: string
			privacyPublishReactionsHint: string
			empty: string
			weight: string
			save: string
			name: {
				placeholder: string
			}
		}
		trending: {
			title: string
			postCount: {
				title: string
			}
			scopeLocal: string
			scopeNearby: string
			empty: string
		}
		search: {
			placeholder: string
			open: {
				'aria-label': string
			}
			submit: string
			clear: string
			empty: string
			tooShort: string
			usersTitle: string
			postsTitle: string
			usersEmpty: string
			pinAlias: string
			trustScore: string
			viewTitle: string
			loading: string
			filterAuthor: {
				placeholder: string
			}
			filterMediaAll: string
			filterMediaImage: string
			filterMediaVideo: string
			filterTag: {
				placeholder: string
			}
			sortRecent: string
			sortPopular: string
			scopeLocal: string
			scopeNearby: string
		}
		profile: {
			edit: string
			viewPosts: string
			settingsBtn: {
				'aria-label': string
			}
			mediaOnly: string
			hideFromExplore: string
			tabPosts: string
			tabAlbums: string
			tabLikes: string
			tabCabinets: string
			tabsLabel: {
				'aria-label': string
			}
			cabinetsEmpty: string
			cabinetsFailed: string
			statsGroup: {
				'aria-label': string
			}
			statsPosts: string
			statsFollowing: string
			statsFollowers: string
			followingTitle: string
			followersTitle: string
		}
		dialog: {
			close: {
				'aria-label': string
			}
		}
		actions: {
			like: string
			unlike: string
			dislike: string
			undislike: string
			repost: string
			quote: string
			delete: string
			edit: string
			save: string
			saved: string
			translate: string
			dm: string
			block: string
			hide: string
			mute: string
			follow: string
			following: string
			care: string
			careRemove: string
			careAdded: string
			careRemoved: string
			setAlias: string
			setAliasPrompt: string
			aliasSaved: string
			replies: string
			copyLink: string
			downloadHtml: string
			copied: string
			more: {
				'aria-label': string
			}
			share: string
			likeFailed: string
			dislikeFailed: string
			repostFailed: string
			replyFailed: string
			followFailed: string
			saveFailed: string
			blockFailed: string
			hideFailed: string
			muteFailed: string
			deleteFailed: string
		}
		post: {
			edited: string
			editPrompt: string
			editHistory: string
			editHistoryEmpty: string
			loading: string
			notFound: string
			loadFailed: string
			detailTitle: string
			back: string
		}
		reply: {
			context: string
		}
		notes: {
			label: string
			add: string
			prompt: string
			listTitle: string
			helpful: string
			unhelpful: string
			more: string
			empty: string
		}
		poll: {
			multi: string
			apply: string
			closed: string
			deadline: string
			options: {
				placeholder: string
			}
		}
		aside: {
			suggested: string
		}
		explore: {
			accounts: string
			posts: string
			mediaOnly: string
		}
		groupRef: {
			linking: string
			clear: string
			pick: string
		}
		notifications: {
			reply: string
			mention: string
			like: string
			repost: string
			follow: string
			care_post: string
			poll_closed: string
			post_note: string
			live_started: string
			view: string
			markAllRead: string
		}
		inbox: {
			filtersLabel: {
				'aria-label': string
			}
			tabs: {
				all: string
				mention: string
				reply: string
				like: string
				follow: string
				repost: string
			}
			aggregated: {
				like: string
				likeTwo: string
				repost: string
				repostTwo: string
				follow: string
				followTwo: string
			}
		}
		replies: {
			placeholder: string
			submit: string
			empty: string
			emptyHint: string
		}
		repost: {
			placeholder: string
			submit: string
		}
		quote: {
			quoting: string
			clear: string
			viewOriginal: string
		}
		a11y: {
			linkGroupSelect: string
			postVisibility: string
			postLang: string
			trendingHashtags: string
			saveFolderSelect: string
		}
		blocklist: {
			title: string
			hiddenTitle: string
			empty: string
			unblock: string
			unhide: string
			scopeEntity: string
			scopeSubject: string
		}
		translate: {
			label: string
		}
		saved: {
			all: string
			unfiled: string
			createFolder: {
				title: string
				'aria-label': string
			}
			createFolderPrompt: string
			pickFolderTitle: string
			confirm: string
			cancel: string
			remove: string
			renameFolder: string
			renameFolderPrompt: string
			deleteFolder: string
			deleteFolderConfirm: string
			searchEmpty: string
			folderEmpty: string
			emptyHint: string
			search: {
				placeholder: string
			}
		}
		drafts: {
			untitled: string
			emptyHint: string
			saved: string
			deleted: string
			delete: string
			empty: string
			saveFailed: string
			loadFailed: string
			deleteFailed: string
		}
		time: {
			justNow: string
			minutesAgo: string
			hoursAgo: string
		}
		empty: {
			feed: string
			profilePosts: string
			following: string
			followers: string
			notifications: string
			saved: string
			drafts: string
			exploreAccounts: string
			explorePosts: string
			likedPosts: string
			noIdentity: string
		}
		topic: {
			follow: string
			unfollow: string
			empty: string
		}
		video: {
			view: {
				'aria-label': string
			}
			empty: string
			emptyHint: string
			compose: string
			back: {
				'aria-label': string
			}
			mute: {
				'aria-label': string
			}
			unmute: {
				'aria-label': string
			}
			unavailable: string
			closeReplies: {
				'aria-label': string
			}
		}
		live: {
			empty: string
			viewers: string
			likes: string
			local: string
			hall: string
			back: {
				title: string
				'aria-label': string
			}
			danmakuSend: string
			postWatch: string
			postEnded: string
			postEndedStats: string
			link: {
				invite: string
				needPeer: string
				invited: string
				linked: string
				peer: {
					placeholder: string
				}
			}
			broadcast: {
				title: string
				open: string
				mediaAv: string
				mediaAudio: string
				mediaVideo: string
				mediaWhip: string
				whipUrl: string
				whipToken: string
				whipWaiting: string
				start: string
				stop: string
				started: string
				stopped: string
				titleInput: {
					placeholder: string
				}
			}
			danmaku: {
				placeholder: string
			}
		}
	}
	chat: {
		title: string
		description: string
		new: {
			title: string
			description: string
		}
		typingIndicator: {
			isTyping: string
			multipleMembers: string
		}
		emoji: {
			pickerTitle: string
			categoryFace: string
			categoryGesture: string
			categoryHeart: string
			categoryAnimal: string
			categoryFood: string
			categoryObject: string
		}
		unicodeEmojiGroups: {
			Smileys_and_Emotion: {
				title: string
			}
			People_and_Body: {
				title: string
			}
			Animals_and_Nature: {
				title: string
			}
			Food_and_Drink: {
				title: string
			}
			Travel_and_Places: {
				title: string
			}
			Activities: {
				title: string
			}
			Objects: {
				title: string
			}
			Symbols: {
				title: string
			}
			Flags: {
				title: string
			}
			Component: {
				title: string
			}
		}
		sessionSettings: {
			unnamedTitle: string
			modeGroup: string
			modeSingle: string
			modeEmpty: string
			subtitleRoles: string
			statusSaved: string
			statusSaving: string
			statusDirty: string
			statusSaveFailed: string
			saveSuccess: string
			saveFailed: string
		}
		group: {
			defaults: {
				groupMetaName: string
				defaultChannelName: string
				dmChatName: string
				dmDmName: string
				threadName: string
			}
			settingsPage: {
				title: string
				kicker: string
				subtitle: string
				backToChat: string
				navigationLabel: string
				advancedNavigationLabel: string
				tabGeneral: string
				tabPermissions: string
				tabMembers: string
				tabAudit: string
				tabEmojis: string
				tabAdvanced: string
				tabStorage: string
				tabChannelPermissions: string
				advancedHubTitle: string
				advancedHubDescription: string
				channelPermsHint: string
				channelPermsSelectChannel: string
				channelPermsAddRole: string
				channelPermsRemoveRole: string
				channelPermsStateNeutral: string
				channelPermsStateAllow: string
				channelPermsStateDeny: string
				channelPermsUpdated: string
				channelPermsUpdateFailed: string
				channelPermsNoChannels: string
				emojisTitle: string
				emojisHint: string
				emojisUpload: string
				emojisDelete: string
				emojisEmpty: string
				emojisUploadOk: string
				emojisUploadFailed: string
				emojisDeleteConfirm: string
				emojisDeleteOk: string
				emojisDeleteFailed: string
				membersTitle: string
				overviewTitle: string
				overviewHint: string
				channelArchiveTitle: string
				channelArchiveHint: string
				channelArchiveImport: string
				channelArchiveImportOk: string
				channelArchiveImportFailed: string
				governanceHint: string
				governanceDenied: string
				rolesDenied: string
				channelPermsDenied: string
				notMember: string
				basicTitle: string
				profileSectionTitle: string
				profileSectionHint: string
				behaviorSectionTitle: string
				networkSectionTitle: string
				retentionSectionTitle: string
				mediaSectionTitle: string
				nameLabel: string
				descriptionLabel: string
				joinPolicyLabel: string
				joinInviteOnly: string
				joinPow: string
				powDifficultyLabel: string
				advancedTitle: string
				advancedDescription: string
				securityAdvancedTitle: string
				securityAdvancedDescription: string
				powDifficultyTip: string
				maxDagPayloadTip: string
				trustedPeersTip: string
				gossipTtlTip: string
				hlcTip: string
				sfuTip: string
				iceTip: string
				fileEncryptionTip: string
				keyManagementTitle: string
				keyManagementTip: string
				allowDangerousHtml: string
				deleteGroup: string
				save: string
				inviteTitle: string
				inviteHint: string
				inviteMint: string
				inviteGroupId: string
				inviteCode: string
				inviteExpires: string
				inviteCopy: string
				inviteCopied: string
				inviteCopyFailed: string
				inviteClipboard: string
				loadFailed: string
				saveSuccess: string
				saveFailed: string
				deleteConfirm: string
				deleteSuccess: string
				deleteFailed: string
				rolesTitle: string
				createRole: string
				roleDefault: string
				deleteRole: string
				deleteRoleConfirm: string
				deleteRoleSuccess: string
				deleteRoleFailed: string
				createRolePrompt: string
				createRoleSuccess: string
				createRoleFailed: string
				permissionUpdated: string
				permissionUpdateFailed: string
				noMembers: string
				memberRoles: string
				kick: string
				ban: string
				kickConfirm: string
				kickSelfNodeWarning: string
				kickSuccess: string
				kickFailed: string
				banConfirm: string
				banSuccess: string
				banFailed: string
				bannedTitle: string
				unban: string
				unbanConfirm: string
				unbanSuccess: string
				unbanFailed: string
				keyRotate: string
				keyRotateConfirm: string
				keyRotateOk: string
				keyRotateFailed: string
				gshGenerationRetentionHint: string
				gshGenerationNearLimit: string
				ownerSuccession: string
				ownerSuccessionOk: string
				ownerSuccessionFailed: string
				permVIEW_CHANNEL: string
				permSEND_MESSAGES: string
				permSEND_STICKERS: string
				permADD_REACTIONS: string
				permMANAGE_MESSAGES: string
				permMANAGE_CHANNELS: string
				permKICK_MEMBERS: string
				permBAN_MEMBERS: string
				permMANAGE_ROLES: string
				permINVITE_MEMBERS: string
				permSTREAM: string
				permCREATE_THREADS: string
				permUPLOAD_FILES: string
				permMANAGE_FILES: string
				permPIN_MESSAGES: string
				permADMIN: string
				permBYPASS_RATE_LIMIT: string
			}
			auditLog: {
				title: string
				hint: string
				filterLabel: string
				refresh: string
				filterAll: string
				loadMore: string
				empty: string
				loadFailed: string
				colTime: string
				colType: string
				colActor: string
				colSummary: string
				type: {
					member_join: string
					member_leave: string
					member_kick: string
					member_ban: string
					member_unban: string
					role_create: string
					role_update: string
					role_delete: string
					role_assign: string
					role_revoke: string
					channel_create: string
					channel_update: string
					channel_delete: string
					channel_permissions_update: string
					group_meta_update: string
					group_settings_update: string
					reputation_slash: string
					reputation_reset: string
					file_master_key_rotate: string
					peer_invite: string
					dag_tip_merge: string
					message_delete: string
					pin_message: string
					unpin_message: string
					file_upload: string
					file_delete: string
				}
				event: {
					member_join: string
					member_leave: string
					member_kick: string
					member_ban: string
					member_unban: string
					role_create: string
					role_update: string
					role_delete: string
					role_assign: string
					role_revoke: string
					channel_create: string
					channel_update: string
					channel_delete: string
					channel_permissions_update: string
					group_meta_update: string
					group_settings_update: string
					reputation_slash: string
					reputation_reset: string
					file_master_key_rotate: string
					channel_key_rotate: string
					peer_invite: string
					dag_tip_merge: string
					message_delete: string
					pin_message: string
					unpin_message: string
					file_upload: string
					file_delete: string
				}
			}
			messagePrefixSticker: string
			membersEmpty: string
			channelEncryptionGsh: string
			ownerSuccession: string
			ownerSuccessionDescription: string
			ownerSuccessionAutoSignHint: string
			ownerSuccessionCandidateLabel: string
			ownerSuccessionSelfButton: string
			ownerSuccessionSubmitted: string
			ownerSuccessionNeedHash: string
			ownerSuccessionFailed: string
			e2eDecryptUnavailable: string
			contentRefBodyPending: string
			contentRefHashMismatch: string
			streamGenerationFailed: string
			convergentEncryptWarn: string
			settingsStreamGeneratingIdle: string
			settingsAutoReplyFrequency: string
			settingsAutoReplyFrequencyHint: string
			settingsMaxDagPayload: string
			settingsBatterySaver: string
			settingsDiscoveryPublic: string
			settingsDiscoveryTitle: string
			settingsDiscoveryBlurb: string
			settingsTrustedPeers: string
			settingsExplorePeers: string
			settingsMaxPeers: string
			settingsGossipTtl: string
			settingsWantIdsBudget: string
			settingsHlcMaxSkew: string
			dagForkDetected: string
			mergeDagTips: string
			mergeDagTipsOk: string
			mergeDagTipsFailed: string
			settingsStreamingSfu: string
			settingsMessageRetention: string
			settingsMessageRetentionForever: string
			settingsMessageRetention30d: string
			settingsMessageRetention90d: string
			settingsMessageRetention1y: string
			settingsMessageRetentionHint: string
			settingsHotLatest: string
			settingsPinContext: string
			settingsHotWindowHint: string
			settingsArchiveTitle: string
			settingsArchiveHint: string
			settingsArchiveFilesTitle: string
			settingsArchiveEmpty: string
			settingsArchiveColChannel: string
			settingsArchiveColMonth: string
			settingsArchiveColSize: string
			settingsArchiveDeleteBefore: string
			settingsArchiveDeleteButton: string
			settingsArchiveDeleteHint: string
			settingsArchiveAdminOnly: string
			settingsArchiveDeleteInvalidMonth: string
			settingsArchiveDeleteConfirm: string
			settingsArchiveDeleteOk: string
			settingsArchiveDeleteFailed: string
			settingsEventRetentionDepth: string
			settingsEventRetentionMs: string
			settingsCompactTriggerDepth: string
			settingsMessageRateLimit: string
			settingsAutoReplyTokenBucket: string
			settingsAutoReplyTokenBucketHint: string
			settingsIceServers: string
			settingsIceServersAdd: string
			settingsIceServersHint: string
			settingsFileCeMode: string
			settingsFileCeModeConvergent: string
			settingsFileCeModeRandom: string
			settingsFileCeModeHint: string
			channelsTitle: string
			createGroup: string
			members: string
			membersHint: string
			send: string
			streamTest: string
			messageInput: {
				placeholder: string
				'aria-label': string
			}
			loadError: string
			remoteNodeTimeout: string
			remoteUnavailable: string
			messagesLoadFailed: string
			sendFailed: string
			chatNotLoaded: string
			createFailed: string
			newGroupName: string
			streamOk: string
			remoteUnsafe: string
			trustAuthor: {
				textContent: string
				title: string
			}
			trustAuthorOk: string
			voteCast: string
			listEmpty: string
			listChannelReadonly: {
				placeholder: string
			}
			streamNoEmbed: {
				textContent: string
			}
			streamNoSfu: {
				textContent: string
			}
			messageDeleted: string
			messageDeletedBracket: string
			messageWithAttachments: string
			voteBlockHeading: string
			voteBlockHeadingTagged: string
			voteCastLine: string
			voteCastLineTagged: string
			voteOptionsPreview: string
			voteOptionsPreviewTagged: string
			voteDeadlineLineOpen: string
			voteDeadlineLineClosed: string
			pinMessageLine: string
			unpinMessageLine: string
			stickerPrefixLine: string
			stickerPrefixLineTagged: string
			feedbackDagLine: string
			feedbackDagLineWithNote: string
			feedbackPreviewLine: string
			feedbackPreviewTaggedNote: string
			mentionHandle: string
			mentionInsert: string
			feedbackUp: string
			feedbackDown: string
			attachmentsHint: string
			pinMessage: string
			unpinMessage: string
			pinThisMessage: string
			pinAction: {
				textContent: string
				title: string
			}
			unpinAction: {
				textContent: string
				title: string
			}
			pinOk: string
			unpinOk: string
			pinFailed: string
			menuCopyText: string
			menuExportHtml: string
			menuCopyId: string
			copied: string
			addBookmark: {
				title: string
			}
			bookmarkExists: string
			bookmarkAdded: string
			bookmarkSaveFailed: string
			remoteTyping: string
			remoteTypingTwo: string
			remoteTypingMany: string
			mentionEmpty: string
			localAiLabel: string
			forceTriggerOne: {
				title: string
			}
			forceTriggerAllLocal: string
			forceTriggerAllLocalTitle: {
				title: string
			}
			messageRefAnchor: string
			settingsFedPartition: string
			settingsRtcBudget: string
			settingsRtcJoinRate: string
			settingsFedTuningHint: string
			settingsAutoChannelGc: string
			settingsAutoChannelGcHint: string
			quoteHeader: string
			quoteHeaderWithTime: string
			quoteHeaderWithoutTime: string
			stopGenerating: string
			messageAborted: string
			avStart: string
			avMute: string
			avSwap: string
			avStop: string
			avNeedStreamChannel: string
			reactionAdd: {
				title: string
			}
			reactionRemove: {
				title: string
			}
			addReaction: {
				title: string
			}
			reactionPrompt: string
			channelTypeLabel: string
			channelTypeText: string
			channelTypeList: string
			channelTypeStreaming: string
			convertToText: string
			convertToList: string
			setAsDefault: string
			isDefault: string
			defaultChannelSet: string
			defaultChannelSetFailed: string
			channelUpdateFailed: string
			voteCreate: string
			votePromptDeadline: string
			voteTooFewOptions: string
			voteCreateFailed: string
			voteFor: string
			voteDeadline: string
			voteEnded: string
			voteTotal: string
			record: string
			fileDownload: {
				title: string
			}
			clickToLoad: string
			unknownFile: string
			blockSender: {
				title: string
			}
			blockConfirm: string
			blockAdded: string
			saveSticker: {
				title: string
			}
			stickerSaved: string
			stickerDefaultName: string
			deleteMessage: {
				title: string
			}
			deleteConfirm: string
			editMessage: {
				title: string
			}
			saveEdit: string
			cancelEdit: string
			editingMessage: string
			editConfirm: string
			editCancel: string
			editHint: string
			editedLabel: string
			editEmptyText: string
			createGroupTitle: string
			groupNameLabel: string
			groupName: {
				placeholder: string
			}
			defaultChannelLabel: string
			defaultChannel: {
				placeholder: string
			}
			createGroupFailed: string
			createChannelFailed: string
			moreActions: {
				title: string
			}
			thread: string
			threadBack: string
			threadBreadcrumbRootTitle: string
			threadBreadcrumbMiddleTitle: string
			threadBreadcrumbMiddleSummary: string
			menuShareExternal: string
			shareExternalOk: string
			shareExternalFailed: string
		}
		hub: {
			title: string
			redirectToHub: string
			homeTooltip: {
				title: string
				tip: string
			}
			charsTooltip: {
				title: string
				tip: string
			}
			friendsTooltip: {
				title: string
				tip: string
			}
			inboxTooltip: {
				title: string
				tip: string
			}
			inbox: {
				title: string
				filtersLabel: string
				tabMention: string
				tabMessage: string
				tabCare: string
				tabVoteClosed: string
				emptyMentionTitle: string
				emptyMentionDescription: string
				emptyMessageTitle: string
				emptyMessageDescription: string
				emptyCareTitle: string
				emptyCareDescription: string
				emptyVoteTitle: string
				emptyVoteDescription: string
				rowLabel: {
					'aria-label': string
				}
				sidebarHint: string
				badgeFetchFailed: string
				loadFailed: string
				markSeenFailed: string
				jumpFailed: string
			}
			notifyPrefs: {
				title: string
				mode: string
				modeAll: string
				modeMentions: string
				modeNothing: string
				suppressEveryone: string
				suppressRoles: string
				mute: string
				muteOff: string
				mute1h: string
				mute8h: string
				muteForever: string
				saved: string
			}
			voteClosed: string
			discoveryTooltip: {
				title: string
				tip: string
			}
			prefsTooltip: {
				title: string
				tip: string
			}
			prefsSubtitle: string
			federationTooltip: {
				title: string
				tip: string
			}
			federationTitle: string
			federationSubtitle: string
			federationLoadFailed: string
			fedConnectionTitle: string
			discoveryRefresh: string
			fedRelayUrlsLabel: string
			fedRelayUrlsTip: string
			fedBatterySaverLabel: string
			fedBatterySaverTip: string
			fedAdvancedTitle: string
			fedAdvancedDescription: string
			fedGroupRecoveryTitle: string
			fedGroupRecoveryTip: string
			fedRotateRoomSecret: string
			fedRotateRoomSecretConfirm: string
			fedRotateRoomSecretOk: string
			fedRepairJoinSnapshot: string
			fedRepairJoinSnapshotOk: string
			fedRepairJoinSnapshotFailed: string
			fedRepTitle: string
			fedRepTip: string
			fedRepEmpty: string
			fedSlashTitle: string
			fedSlashTip: string
			fedSlashTargetLabel: string
			fedSlashTarget: {
				placeholder: string
			}
			fedSlashClaimLabel: string
			fedSlashVerifiedLabel: string
			fedSlashProofLabel: string
			fedSlashProof: {
				placeholder: string
			}
			fedSlashSubmitLabel: string
			fedResetSubmitLabel: string
			fedSlashNeedHash: string
			fedSlashOk: string
			fedResetOk: string
			fedDmLinkTitle: string
			fedDmLinkTip: string
			fedDmLinkDescription: string
			fedDmPubKeyLabel: string
			fedDmSecretLabel: string
			fedDmNodeLabel: string
			fedDmInvalidateTitle: string
			fedDmInvalidateDescription: string
			fedDmRotateLabel: string
			fedDmRotateConfirm: string
			fedDmIssueLabel: string
			fedDmNeedPubKey: string
			fedDmNeedSecretKey: string
			fedDmIssued: string
			fedNonceRotated: string
			fedSaved: string
			addServerTooltip: {
				title: string
				tip: string
			}
			pinsTitle: string
			bookmarksTitle: string
			pinsButton: {
				title: string
			}
			bookmarksButton: {
				title: string
			}
			search: {
				placeholder: string
				noResults: string
				failed: string
				scopeGroup: string
				scopeAll: string
			}
			membersTitle: {
				title: string
			}
			backToNav: {
				title: string
				'aria-label': string
			}
			moreActions: {
				title: string
				'aria-label': string
			}
			composerMore: {
				title: string
				'aria-label': string
			}
			settingsTitle: {
				title: string
			}
			filesTitle: {
				title: string
			}
			filesDrawerTitle: string
			filesLoading: string
			filesLoadFailed: string
			filesNoGroup: string
			filesNoCabinets: string
			filesBindCabinet: string
			filesNoChannel: string
			filesUploadTo: string
			filesRootFolder: string
			filesNewFolder: string
			filesNewFolderPrompt: string
			filesRename: string
			filesRenameFolderPrompt: string
			filesDeleteFolderConfirm: string
			filesUpload: string
			filesDownload: string
			filesDelete: string
			filesDeleteConfirm: string
			filesFoldersTitle: string
			filesListTitle: string
			filesEmpty: string
			filesNoFolders: string
			uploadTitle: {
				title: string
			}
			emojiTitle: {
				title: string
			}
			voteTitle: {
				title: string
			}
			shareGroupTitle: {
				title: string
			}
			shareGroupOk: string
			messageActionFailed: string
			inviteJoinButton: string
			inviteLinkNeedsRoomSecret: string
			inviteCardMembers: string
			syncFailed: string
			syncRateLimited: string
			syncIncomplete: string
			syncNoPeers: string
			attachmentLoadFailed: string
			messageEditUpload: string
			timeToday: string
			timeYesterday: string
			stickerTitle: {
				title: string
			}
			sendTitle: {
				title: string
			}
			stopGenerateTitle: {
				title: string
			}
			charTyping: string
			messageActionPrev: {
				title: string
			}
			messageActionNext: {
				title: string
			}
			messageActionRegen: {
				title: string
			}
			messageActionEdit: {
				title: string
			}
			messageActionFeedbackUp: {
				title: string
			}
			messageActionFeedbackDown: {
				title: string
			}
			messageActionDelete: {
				title: string
			}
			confirmDeleteLong: string
			messageActionCopyHtml: {
				title: string
			}
			forceReply: string
			removeChar: string
			loadMore: string
			charChatsTitle: string
			newGroupWith: string
			messageActionBookmark: {
				title: string
			}
			messageActionPin: {
				title: string
			}
			messageActionUnpin: {
				title: string
			}
			blockAuthor: {
				title: string
			}
			pinUnpinSidebar: {
				title: string
			}
			meAuthor: string
			messageEditSave: string
			messageEditCancel: string
			feedbackReasonPrompt: string
			feedbackReasonInput: {
				placeholder: string
			}
			messageFeedbackSubmit: string
			stickersPanelTitle: string
			stickersManage: string
			stickersLoading: string
			recentEmojiTab: {
				title: string
			}
			recentEmojisEmpty: string
			currentGroupEmojiTab: {
				title: string
			}
			groupEmojiTab: {
				title: string
			}
			groupEmojisEmpty: string
			groupEmojisLoadFailed: string
			profileLinkTitle: {
				title: string
				textContent: string
			}
			userLoading: string
			status: {
				online: string
				idle: string
				dnd: string
				invisible: string
				offline: string
			}
			changeStatusTitle: string
			aboutSection: string
			bioEmpty: string
			statusOffline: {
				title: string
				textContent: string
			}
			statusOnline: {
				title: string
				textContent: string
			}
			statusIdle: {
				title: string
				textContent: string
			}
			statusDnd: {
				title: string
				textContent: string
			}
			banners: {
				gshBuffer: string
				plaintextSidecar: string
				quarantine: string
				mailboxPending: string
				syncing: string
				archiveCoverageIncomplete: string
				archiveSyncButton: string
				forkGovernance: string
				forkTips: string
				forkTipLabel: string
				forkTipScore: string
				applyBranch: string
				autoBranch: string
				mergeDag: string
				splitFork: string
				blockOpposing: string
				suspectedRemoved: string
				suspectedRemovedKeep: string
				suspectedRemovedLeave: string
			}
			blockOpposingConfirm: string
			blockOpposingOk: string
			blockOpposingFailed: string
			applyBranchOk: string
			applyBranchFailed: string
			autoBranchOk: string
			autoBranchFailed: string
			saveEmoji: {
				title: string
			}
			saveEmojiOk: string
			saveEmojiFailed: string
			saveSticker: {
				title: string
			}
			saveStickerOk: string
			saveStickerFailed: string
			revealRemoteMd: string
			voteModalTitle: string
			voteModalSubmit: string
			voteCreateFailed: string
			composer: {
				placeholder: string
			}
			composerSuspectedRemoved: {
				placeholder: string
			}
			channelReadonlyList: {
				placeholder: string
			}
			channelReadonlyStream: {
				placeholder: string
			}
			noChannels: string
			noMembers: string
			noPins: string
			noBookmarks: string
			adminSection: string
			memberSection: string
			membersDigestOk: string
			membersDigestOkPaged: string
			membersDigestMismatch: string
			membersDigestPending: string
			membersDigestFetchFailed: string
			copyEntityId: string
			copyEntityIdOk: string
			memberJoined: string
			remoteBadge: {
				textContent: string
				title: string
			}
			trustAuthor: {
				textContent: string
				title: string
			}
			stickerInline: string
			voteDeadline: string
			voteNoOptions: string
			voteTotal: string
			voteCount: string
			loadGroupFailed: string
			groupJoinRequired: string
			sendFailed: string
			sendFailedPending: string
			markdownRenderFailed: string
			retrySend: string
			sendImageFailed: string
			sendStickerFailed: string
			voteMinOptions: string
			mergeDagOk: string
			mergeDagFailed: string
			forkSplitFailed: string
			forkSplitPrompt: string
			forkSplitModalTitle: string
			forkSplitModalSubmit: string
			typing: string
			charsHeader: string
			friendsHeader: string
			settingsModalTitle: string
			modalClose: string
			groupTag: string
			groupUnnamed: string
			groupHeaderMenu: {
				title: string
			}
			groupDescriptionEmpty: string
			serverActionPickerTitle: string
			serverActionPickerSubtitle: string
			serverActionPickerCreate: string
			serverActionPickerCreateDescription: string
			serverActionPickerJoin: string
			serverActionPickerJoinDescription: string
			cancel: string
			folderDefault: string
			folderRename: string
			folderRenamePrompt: string
			folderCollapse: string
			folderExpand: string
			folderDissolve: string
			bookmarkLocal: string
			groupsSection: string
			ungrouped: string
			defaultCategory: string
			bookmarkFallback: string
			bookmarkRemove: {
				title: string
				'aria-label': string
			}
			loadMessagesFailed: string
			unreadDivider: string
			noUsername: string
			stickersEmpty: string
			stickersMarketLink: string
			stickersLoadFailed: string
			noChars: string
			noFriends: string
			friendsEmptyTitle: string
			friendsEmptyDescription: string
			friendsEmptyAction: string
			friendsSearchEmpty: string
			friendsSearchTooShort: string
			friendsSearchDm: string
			friendsSearchChat: string
			friendsSearchLocalChar: string
			friendsSearchPin: string
			charCount: string
			friendsCount: string
			charTag: string
			friendsTag: string
			backToFriends: string
			dmTopicsTitle: string
			friendsContextNewChat: string
			friendsRestartConfirm: string
			friendsRestartOk: string
			friendsRestartFailed: string
			charDescriptionEmpty: string
			charIntro: string
			participants: string
			charTagSolo: string
			startChatWith: string
			loading: string
			charChatStart: string
			charChatEmpty: string
			loadCharChatFailed: string
			createChatFailed: string
			charChatComposer: {
				placeholder: string
			}
			friendChatComposer: {
				placeholder: string
			}
			trustOk: string
			trustAuthorDialog: {
				title: string
				subtitle: string
				warningTitle: string
				warningBody: string
				durationLabel: string
				duration3h: string
				duration7d: string
				duration1Month: string
				durationForever: string
				confirmCooldown: string
				confirmFirst: string
				confirmSecond: string
				cancel: string
			}
			blockConfirm: string
			blockOk: string
			charChatSettings: string
			charChatSubtitle: string
			sessionInfo: string
			sessionRole: string
			sessionId: string
			sessionMessages: string
			quickActions: string
			advancedSettings: string
			advancedSettingsDescription: string
			dangerZone: string
			unbindFriendDescription: string
			unbindFriend: string
			unbindFriendConfirm: string
			unbindFriendOk: string
			unbindFriendFailed: string
			deleteSessionDescription: string
			deleteSession: string
			deleteSessionConfirm: string
			sessionDeleted: string
			sessionDeleteFailed: string
			streamTokenFailed: string
			streamAvJoin: string
			streamAvLeave: string
			streamAvMute: string
			streamAvUnmute: string
			streamAvVideo: string
			streamAvVideoOn: string
			streamAvYou: string
			streamAvJoinFailed: string
			streamAvNoCodecs: string
			streamAvPeers: string
			streamAvPresetThumb: string
			streamAvPresetLow: string
			streamAvPresetMed: string
			streamAvPresetHigh: string
			callButton: {
				title: string
				'aria-label': string
			}
			callInProgress: string
			callEnded: string
			callJoin: string
			callHangup: string
			callScreenShare: string
			callScreenStop: string
			callJumpBack: string
			callJoinFailed: string
			callScreenFailed: string
			callStartedAt: string
			callDuration: string
			callParticipants: string
			callPeerCount: string
			callNoParticipants: string
			listChannelEmpty: string
			listItemUntitled: string
			listEditorTitle: string
			listSaveToDag: string
			listJsonInvalid: string
			listSaved: string
			listSaveFailed: string
			streamDefaultName: string
			streamRefreshToken: string
			streamEmbedHttpsRequired: string
			streamWebRtcHint: string
			pinPreviewSticker: string
			pinPreviewVote: string
			pinPreviewInvite: string
			reactionRemovePrompt: string
			ariaDagTip: {
				'aria-label': string
			}
			ariaClose: {
				'aria-label': string
			}
			membersDigestPagesTitle: {
				title: string
			}
			discoveryTitle: string
			discoveryEyebrow: string
			discoveryDescription: string
			discoverySidebarHint: string
			discoveryEmptyTitle: string
			discoveryEmpty: string
			discoveryNoDescription: string
			discoverySourceCount: string
			discoveryJoin: string
			discoveryOpen: string
			discoveryLoadFailed: string
			operationFailed: string
			shareGroupFailed: string
			blockAuthorTitle: string
			configTitle: string
			configSaved: string
			configSaveFailed: string
			configLoadFailed: string
			noActiveChat: string
			groupContext: {
				manage: string
				notifyPrefs: string
				invite: string
				inviteCopied: string
				addChar: string
				addCharLabel: string
				addCharSubmit: string
				noChars: string
				setAlias: string
				setAliasPrompt: string
				aliasSaved: string
				leave: string
				leaveConfirm: string
				leaveOk: string
				leaveBatch: string
				leaveConfirmBatch: string
				leaveBatchPending: string
				leaveBatchOk: string
				leaveBatchPartial: string
			}
			replyInline: {
				title: string
			}
			replyClear: {
				title: string
			}
			replyInThread: {
				title: string
			}
			syncTruncated: string
			syncTruncatedHint: string
			newChannelButton: string
			newChannelSuccess: string
			newChannelFailed: string
			newChannelTitle: string
			channelName: string
			channelType: string
			channelTypeText: string
			channelTypeList: string
			channelTypeStreaming: string
			channelNameInput: {
				placeholder: string
			}
			localMaterializedView: string
			convergentEncryptWarn: string
			votePromptQuestion: string
			votePromptOptions: string
			voteOptionDefault: string
			votePromptDeadlineHours: string
			messagePrefixVote: string
			threadCreated: string
			threadCreateFailed: string
			threadDrawer: {
				'aria-label': string
			}
			threadClose: {
				title: string
			}
			reputationSlashAlert: string
			profileEdit: {
				previewHint: string
				livePreview: string
				languageVersion: string
				localeHint: string
				themeColorHint: string
				bannerLabel: string
				bannerHint: string
				bannerClear: string
				linksPreview: string
				unsavedHint: string
				tagsLabel: string
				tagAdd: string
				tagRemove: string
				linksLabel: string
				linkAdd: string
				linkRemove: string
				handleLabel: string
				handleHint: string
				resetFromPart: string
				resetFromPartConfirm: string
				resetFromPartDone: string
				resetFromPartFailed: string
				newLocale: {
					placeholder: string
				}
				avatarUrl: {
					placeholder: string
				}
				bannerUrl: {
					placeholder: string
				}
				tag: {
					placeholder: string
				}
				linkName: {
					placeholder: string
				}
				linkUrl: {
					placeholder: string
				}
				handle: {
					placeholder: string
				}
			}
			profilePopup: {
				close: {
					title: string
				}
				editSaved: string
				editQueued: string
				dmChar: string
				dmUser: string
				dmFed: string
				noFedIdentity: string
				peerNoIdentity: string
				dmFailed: string
				care: string
				careRemove: string
				setAlias: string
				setAliasPrompt: string
			}
			channelContext: {
				copyLinkDone: string
				notifyPrefs: string
				rename: string
				renameOk: string
				delete: string
				deleteOk: string
				deleteConfirm: string
				setDefault: string
				setDefaultOk: string
				copyLink: string
				exportJson: string
				exportOk: string
				exportFailed: string
			}
			memberContext: {
				copyName: string
				mention: string
				care: string
				careAdded: string
				careRemoved: string
				setAlias: string
				setAliasPrompt: string
				aliasSaved: string
				copyPubKey: string
				copyEntityId: string
				dm: string
				kick: string
				kickSelfNodeWarning: string
				ban: string
				personalBlock: string
				personalBlockConfirm: string
				personalBlockSuccess: string
				banTitle: string
				banEntity: string
				banNode: string
			}
			messageContext: {
				edit: string
				delete: string
			}
			charStreaming: string
			gshDecryptPending: string
			gshDecryptFailed: string
			fileDecryptFailed: string
			reactionFailed: string
			fileUploadChecking: string
			fileUploadingChunk: string
			fileUploadRegistering: string
			fileUploaded: string
			fileUploadFailed: string
			fileSkippedDedup: string
			fileDownloadFailed: string
			fileNoKey: string
			fileLoadFailed: string
			createModal: {
				title: string
				subtitle: string
				basicSection: string
				nameLabel: string
				name: {
					placeholder: string
				}
				descriptionLabel: string
				description: {
					placeholder: string
				}
				joinSection: string
				joinInviteOnly: string
				joinInviteOnlyDescription: string
				joinPow: string
				joinPowDescription: string
				cancel: string
				submit: string
				failed: string
			}
			joinModal: {
				title: string
				subtitle: string
				groupIdLabel: string
				groupId: {
					placeholder: string
				}
				inviteLabel: string
				invite: {
					placeholder: string
				}
				hint: string
				cancel: string
				submit: string
			}
			menuCopy: string
			menuMD: string
			menuTXT: string
			menuHTML: string
			menuDownload: string
			menuDelete: string
			menuShareGroup: string
			menuPrev: string
			menuNext: string
			menuShare: {
				'1h': string
				'12h': string
				'24h': string
				'72h': string
			}
			noGroups: string
			myGroups: string
			joinGroup: string
			createGroup: string
			noDescription: string
			memberCountLabel: string
			loadListFailed: string
			contentWarning: string
			sensitiveMedia: string
			revealContent: string
			revealMedia: string
			copyShareLink: string
			forward: string
			forwardedFrom: string
			forwardDialog: {
				title: string
				selectGroup: string
				selectChannel: string
				confirm: string
				cancel: string
				success: string
				failed: string
			}
			deliverySending: string
			deliverySent: string
			deliveryRead: string
			translate: string
			translating: string
			translateShowOriginal: string
			translateShowTranslation: string
			translateLabel: string
			translateFailed: string
			editImage: string
			draftRestored: string
			queuedOffline: string
			translationPrefs: {
				title: string
				textContent: string
				autoTranslate: string
				hint: string
				save: string
				saved: string
				saveFailed: string
			}
			friendsSearch: {
				placeholder: string
			}
			threadComposer: {
				placeholder: string
			}
			altImage: {
				placeholder: string
				label: string
			}
		}
		sidebar: {
			settings: {
				title: string
			}
			noSelection: string
			noDescription: string
			world: {
				icon: {
					alt: string
				}
				title: string
			}
			persona: {
				icon: {
					alt: string
				}
				title: string
			}
			charList: {
				icon: {
					alt: string
				}
				title: string
				buttons: {
					addChar: {
						title: string
					}
					addCharIcon: {
						alt: string
					}
				}
			}
			pluginList: {
				icon: {
					alt: string
				}
				title: string
				buttons: {
					addPlugin: {
						title: string
					}
					addPluginIcon: {
						alt: string
					}
				}
			}
			dataMgmt: {
				title: string
				compact: string
				prune: string
				compactSuccess: string
				compactError: string
				pruneSuccess: string
				pruneError: string
				invalidN: string
			}
		}
		rightSidebar: {
			title: string
		}
		chatArea: {
			title: string
			input: {
				placeholder: string
			}
			menuButton: {
				title: string
			}
			menuButtonIcon: {
				alt: string
			}
			sendButton: {
				title: string
			}
			sendButtonIcon: {
				alt: string
			}
			uploadButton: {
				title: string
			}
			uploadButtonIcon: {
				alt: string
			}
			voiceButton: {
				title: string
			}
			voiceButtonIcon: {
				alt: string
			}
			photoButton: {
				title: string
			}
			photoButtonIcon: {
				alt: string
			}
		}
		messageList: {
			confirmDeleteMessage: string
		}
		voiceRecording: {
			errorAccessingMicrophone: string
		}
		messageView: {
			buttons: {
				edit: {
					title: string
				}
				editIcon: {
					alt: string
				}
				more: {
					title: string
				}
				moreIcon: {
					alt: string
				}
				delete: {
					alt: string
				}
				deleteIcon: {
					alt: string
				}
				downloadHtml: {
					alt: string
				}
				downloadHtmlIcon: {
					alt: string
				}
			}
			copyButton: {
				title: string
			}
			copyButtonIcon: {
				alt: string
			}
			copySuccess: string
			dropdown: {
				delete: string
				deleteIcon: {
					alt: string
				}
				copyMarkdown: string
				copyMarkdownIcon: {
					alt: string
				}
				copyText: string
				copyTextIcon: {
					alt: string
				}
				copyHtml: string
				copyHtmlIcon: {
					alt: string
				}
				downloadHtml: string
				downloadHtmlIcon: {
					alt: string
				}
				share: {
					textContent: string
					'1h': string
					'12h': string
					'24h': string
					'72h': string
				}
				shareIcon: {
					alt: string
				}
			}
			share: {
				uploading: string
				success: string
			}
			commonToolCalling: string
			toolRunningLang: string
			toolSearchingContent: string
			toolOverridingFilepath: string
			toolReplacingFilepath: string
			toolReadingFilepath: string
			reasoningDetailsTitle: string
			logprobsNotApplicable: string
			logprobsTopLogprobsMeta: string
			logprobsMetricsFooter: string
			noReplyContent: string
			feedback: {
				thumbsUp: {
					title: string
				}
				thumbsDown: {
					title: string
				}
				regenerate: {
					title: string
				}
				reason: {
					placeholder: string
				}
				submit: string
				cancel: string
			}
		}
		messageEdit: {
			input: {
				placeholder: string
			}
			buttons: {
				confirm: {
					title: string
				}
				confirmIcon: {
					alt: string
				}
				cancel: {
					title: string
				}
				cancelIcon: {
					alt: string
				}
				upload: {
					title: string
				}
				uploadIcon: {
					alt: string
				}
			}
		}
		messageGenerating: {
			tips: string
			stop: {
				textContent: string
				title: string
			}
			stopIcon: {
				alt: string
			}
		}
		attachment: {
			buttons: {
				download: {
					title: string
				}
				downloadIcon: {
					alt: string
				}
				delete: {
					title: string
				}
				deleteIcon: {
					alt: string
				}
			}
		}
		charCard: {
			frequencyLabel: string
			buttons: {
				removeChar: {
					title: string
				}
				removeCharIcon: {
					alt: string
				}
				forceReply: {
					title: string
				}
				forceReplyIcon: {
					alt: string
				}
			}
		}
		pluginCard: {
			buttons: {
				removePlugin: {
					title: string
				}
				removePluginIcon: {
					alt: string
				}
			}
		}
		achievements: {
			first_chat: {
				name: string
				description: string
				locked_description: string
			}
			multiplayer_chat: {
				name: string
				description: string
				locked_description: string
			}
			photo_chat: {
				name: string
				description: string
				locked_description: string
			}
			code_greeting: {
				name: string
				description: string
				locked_description: string
			}
		}
		dragAndDrop: {
			invalidPartData: string
			charAdded: string
			personaSet: string
			worldSet: string
			pluginAdded: string
			unsupportedPartType: string
			errorAddingPart: string
		}
		home_char_interfaces: {
			main: {
				title: string
			}
		}
		home_function_buttons: {
			chatHub: {
				title: string
			}
		}
	}
	easynew: {
		title: string
		description: string
		info: {
			description: string
		}
		cardTitle: string
		templateSelect: {
			label: string
		}
		alerts: {
			success: string
			error: string
		}
		form: {
			partName: {
				label: string
				placeholder: string
			}
			description: {
				label: string
				placeholder: string
			}
			descriptionMarkdown: {
				label: string
				placeholder: string
			}
			imageUpload: {
				label: string
			}
			charDef: {
				heading: string
			}
			personality: {
				label: string
				placeholder: string
			}
			scenario: {
				label: string
				placeholder: string
			}
			mesExample: {
				label: string
				placeholder: string
			}
			firstMessage: {
				label: string
				placeholder: string
			}
			personaDef: {
				heading: string
			}
			personaUserName: {
				label: string
				placeholder: string
			}
			personaAppearance: {
				label: string
				placeholder: string
			}
			personaPersonality: {
				label: string
				placeholder: string
			}
			worldDef: {
				heading: string
			}
			worldPrompt: {
				label: string
				placeholder: string
			}
			worldGreeting: {
				label: string
				placeholder: string
			}
			author: {
				label: string
				placeholder: string
			}
			version: {
				label: string
				placeholder: string
			}
			tags: {
				label: string
				placeholder: string
			}
			homePage: {
				label: string
				placeholder: string
			}
			issuePage: {
				label: string
				placeholder: string
			}
			createButton: string
		}
		achievements: {
			create_part: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					quickCreate: {
						title: string
					}
				}
			}
		}
	}
	import: {
		title: string
		description: string
		tabs: {
			tabsLabel: {
				'aria-label': string
			}
			fileImport: string
			textImport: string
		}
		dropArea: {
			icon: {
				alt: string
			}
			textContent: string
		}
		textArea: {
			placeholder: string
		}
		buttons: {
			import: string
		}
		fileItem: {
			removeButton: {
				title: string
			}
			removeButtonIcon: {
				alt: string
			}
		}
		alerts: {
			importSuccess: string
			importFailed: string
			unknownError: string
		}
		errors: {
			noFileSelected: string
			fileImportFailed: string
			noTextContent: string
			textImportFailed: string
			handler: string
			error: string
			unknownError: string
		}
		dragAndDrop: {
			fileDropDescription: string
			textDropDescription: string
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					import: {
						title: string
					}
				}
			}
		}
		home_drag_in_handlers: {
			handleTextDrop: {
				description: string
			}
			handleFileDrop: {
				description: string
			}
		}
	}
	export: {
		title: string
		pageTitle: string
		pageSubtitle: string
		description: string
		steps: {
			part: string
			action: string
		}
		labels: {
			part: string
		}
		placeholders: {
			partTypeSelect: string
			partSelect: string
		}
		partSelectDropdown: {
			placeholder: string
		}
		partSearch: {
			placeholder: string
		}
		options: {
			withData: string
			withDataDescription: string
		}
		export: {
			title: string
		}
		editor: {
			disabledIndicator: string
			disabledIndicatorHint: string
		}
		buttons: {
			export: string
			exportWithData: string
			copyShareLink: string
			generateShareLink: string
			generateShareLinkWithData: string
		}
		shareMenu: {
			title: string
			'1h': string
			'12h': string
			'24h': string
			'72h': string
			cancel: string
		}
		litterbox: {
			poweredBy: string
			sponsorLink: string
		}
		errorMessage: {
			icon: {
				alt: string
			}
		}
		alerts: {
			fetchPartTypesFailed: string
			fetchPartsFailed: string
			loadPartDetailsFailed: string
			exportFailed: string
			shareLinkCopied: string
			shareFailed: string
		}
		achievements: {
			share_part: {
				name: string
				description: string
				locked_description: string
			}
		}
		dragAndDrop: {
			downloadPartDescription: string
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					exportPart: {
						title: string
					}
				}
			}
		}
		home_drag_out_generators: {
			generateDownloadUrl: {
				description: string
			}
		}
		home_common_interfaces: {
			main: {
				title: string
			}
		}
	}
	uninstall: {
		title: string
		description: string
		titleWithName: string
		confirmMessage: string
		invalidParamsTitle: string
		infoMessage: {
			icon: {
				alt: string
			}
		}
		buttons: {
			confirm: string
			cancel: string
			back: string
		}
		alerts: {
			success: string
			failed: string
			invalidParams: string
			pathNotFound: string
			httpError: string
		}
		errorMessage: {
			icon: {
				alt: string
			}
		}
		home_common_interfaces: {
			delete: {
				title: string
			}
		}
	}
	userSettings: {
		title: string
		PageTitle: string
		description: string
		shell: {
			unauthorized: string
			responseNotJson: string
			unexpectedError: string
		}
		errors: {
			accountNotFound: string
		}
		userInfo: {
			title: string
			usernameLabel: string
			creationDateLabel: string
			folderSizeLabel: string
			folderPathLabel: string
			copyPathButton: {
				title: string
			}
			copyPathButtonIcon: {
				alt: string
			}
			copiedAlert: string
			copyPathFailed: string
		}
		changePassword: {
			title: string
			currentPasswordLabel: string
			newPasswordLabel: string
			confirmNewPasswordLabel: string
			submitButton: string
			errorMismatch: string
			success: string
			missingFields: string
			invalidCurrent: string
		}
		renameUser: {
			title: string
			newUsernameLabel: string
			submitButton: string
			confirmMessage: string
			success: string
			missingParams: string
			wrongPassword: string
			mustDiffer: string
			taken: string
			moveFailed: string
		}
		passkeys: {
			title: string
			description: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
			nameLabel: string
			nameInput: {
				placeholder: string
			}
			addButton: string
			noneFound: string
			itemDetails: string
			removeButton: string
			removeConfirm: string
			removeSuccess: string
			addSuccess: string
			errorLoadLibrary: string
			errorCancelled: string
			apiInvalidPassword: string
			apiMissingCredential: string
			apiRemoveParamsRequired: string
		}
		userDevices: {
			title: string
			noDevicesFound: string
			deviceInfo: string
			thisDevice: string
			deviceDetails: string
			revokeButton: string
			revokeConfirm: string
			revokeSuccess: string
			revokeMissingParams: string
			revokeWrongPassword: string
			listNotFound: string
			deviceNotFound: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
		}
		apiKeys: {
			title: string
			description: string
			input: {
				placeholder: string
			}
			createButton: string
			noKeysFound: string
			keyDetails: string
			neverUsed: string
			noKeysForUser: string
			revokeWrongPassword: string
			keyNotFound: string
			revokeMissingJti: string
			revokeMissingPassword: string
			verifyMissingApiKey: string
			revokeButton: string
			revokeConfirm: string
			revokeSuccess: string
			errorDescriptionRequired: string
			createSuccess: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
		}
		newApiKey: {
			title: string
			warning: string
			closeButton: string
			copyButton: {
				title: string
			}
			copiedAlert: string
			copyKeyFailed: string
		}
		editorCommand: {
			title: string
			description: string
			editorPresetLabel: string
			commandLabel: string
			argsTemplateLabel: string
			argsTemplateHint: string
			presetOptionPathAvailable: string
			presetOptionPathUnavailable: string
			testPathInput: {
				placeholder: string
			}
			testButton: string
			saveButton: string
			saveSuccess: string
			testPathRequired: string
			testSuccess: string
		}
		logout: {
			title: string
			description: string
			buttonText: string
			confirmMessage: string
			successMessage: string
		}
		deleteAccount: {
			title: string
			warning: string
			submitButton: string
			confirmMessage1: string
			confirmMessage2: string
			usernameMismatch: string
			success: string
			missingPassword: string
			wrongPassword: string
		}
		passwordConfirm: {
			title: string
			message: string
			passwordLabel: string
			confirmButton: string
			cancelButton: string
		}
		apiError: string
		generalError: string
		home_function_buttons: {
			settings: {
				title: string
				sub_items: {
					main: {
						title: string
					}
				}
			}
		}
	}
	subfounts: {
		title: string
		pageTitle: string
		description: string
		hostConnectionCode: {
			title: string
			connectionCodeLabel: string
			passwordLabel: string
			copyButton: string
			regenerateButton: string
			infoMessage: string
			connectionCodeCopied: string
			passwordCopied: string
			regenerateSuccess: string
		}
		infra: {
			title: string
			description: string
			capabilityRelay: string
			capabilityMailbox: string
			hostPriority: string
			toggleLabel: string
			enabledToast: string
			disabledToast: string
		}
		connectedSubfounts: {
			title: string
			noSubfountsConnected: string
			table: {
				id: string
				description: string
				deviceId: string
				connectedAt: string
				status: string
				actions: string
				connected: string
				disconnected: string
				save: string
				na: string
			}
			descriptionSaved: string
			descriptionSaveFailed: string
		}
		codeExecution: {
			title: string
			description: string
			selectSubfountLabel: string
			hostOption: string
			subfountOption: string
			scriptLabel: string
			executeButton: string
			executing: string
			noSubfountSelected: string
			noScriptProvided: string
			executionSuccess: string
			executionFailed: string
			selectSubfount: string
		}
		downloadClient: {
			title: string
			description: string
			downloadButton: string
		}
		errors: {
			loadConnectionCodeFailed: string
			regenerateConnectionCodeFailed: string
			loadSettingsFailed: string
			saveSettingsFailed: string
			generalError: string
		}
		home_function_buttons: {
			in_dev: {
				title: string
				sub_items: {
					subfounts_related: {
						title: string
						sub_items: {
							main: {
								title: string
							}
						}
					}
				}
			}
		}
	}
	languageSettings: {
		title: string
		pageTitle: string
		description: string
		pageDescription: string
		availableLanguages: string
		preferredLanguages: string
		resetButton: string
		saveButton: string
		select: {
			placeholder: string
		}
		search: {
			placeholder: string
		}
		noPreferredLanguages: string
		moveUpButton: {
			'aria-label': string
			alt: string
		}
		moveDownButton: {
			'aria-label': string
			alt: string
		}
		deleteLocaleButton: {
			'aria-label': string
			alt: string
		}
		savedMessage: string
		resetMessage: string
		fetchLocalesFailed: string
		home_function_buttons: {
			settings: {
				title: string
				sub_items: {
					main: {
						title: string
					}
				}
			}
		}
	}
	themeManage: {
		title: string
		description: string
		instruction: string
		search: {
			placeholder: string
			noResult: string
		}
		createButton: string
		preview: {
			editButton: {
				title: string
			}
			editButtonIcon: {
				alt: string
			}
			deleteButton: {
				title: string
			}
			deleteButtonIcon: {
				alt: string
			}
			cloneButton: {
				title: string
			}
			cloneButtonIcon: {
				alt: string
			}
		}
		editor: {
			title: string
			cancelButton: string
			saveApplyButton: string
			themeName: string
			autoPaletteTitle: string
			autoPaletteInstruction: string
			coreColors: string
			baseBackground: string
			variables: string
			borderRadius: string
			borderWidth: string
			advancedCustomization: string
			customCSS: string
			customMjsScript: string
			mjsSyntaxHint: string
			themeIdRequired: string
			newThemeName: string
			deleteConfirm: string
			saved: string
			failedToSave: string
			failedToDelete: string
			failedToClone: string
		}
		themes: {
			auto: string
			light: string
			dark: string
			cupcake: string
			bumblebee: string
			emerald: string
			corporate: string
			synthwave: string
			retro: string
			cyberpunk: string
			valentine: string
			halloween: string
			garden: string
			forest: string
			aqua: string
			lofi: string
			pastel: string
			fantasy: string
			wireframe: string
			black: string
			luxury: string
			dracula: string
			cmyk: string
			autumn: string
			business: string
			acid: string
			lemonade: string
			night: string
			coffee: string
			winter: string
			dim: string
			nord: string
			sunset: string
			caramellatte: string
			abyss: string
			silk: string
		}
		achievements: {
			change_theme: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			settings: {
				title: string
				sub_items: {
					switchTheme: {
						title: string
					}
				}
			}
		}
	}
	part_config: {
		title: string
		pageTitle: string
		description: string
		labels: {
			part: string
		}
		placeholders: {
			partTypeSelect: string
			partSelect: string
		}
		editor: {
			title: string
			disabledIndicator: string
			jsonEditor: {
				'aria-label': string
			}
			buttons: {
				save: string
			}
		}
		errorMessage: {
			icon: {
				alt: string
			}
		}
		alerts: {
			fetchPartTypesFailed: string
			fetchPartsFailed: string
			loadEditorFailed: string
			saveConfigFailed: string
			saveConfigSuccess: string
			noPartSelected: string
			unsavedChanges: string
			beforeUnload: string
		}
		home_function_buttons: {
			component_related: {
				title: string
				sub_items: {
					componentConfigLink: {
						title: string
					}
				}
			}
		}
		home_common_interfaces: {
			main: {
				title: string
			}
		}
	}
	serviceSource_manager: {
		title: string
		description: string
		fileList: {
			title: string
			addButton: {
				title: string
			}
		}
		configTitle: string
		needsConfigReminder: string
		needsConfigLink: string
		subtypeSelect: {
			label: string
			placeholder: string
		}
		generatorSelect: {
			label: string
			placeholder: string
		}
		paths: {
			serviceSource: string
			generator: string
		}
		editor: {
			disabledIndicator: string
		}
		common_config_interface: {
			empty_generator: string
			loadingModels: string
			availableModels: string
			copied: string
			apiKeyRequired: string
			copyModelIdTooltip: string
			loadModelsFailed: string
			modelSearchTitle: string
			modelSearchHint: string
			modelsDevLoading: string
			modelsDevLoadFailed: string
			noModelsMatched: string
			currentModelTitle: string
			providerLabel: string
			metaContext: string
			metaOutputLimit: string
			metaInputPrice: string
			metaOutputPrice: string
			metaCachePrice: string
			metaModalities: string
			metaReasoning: string
			metaToolCall: string
			metaVision: string
			metaOpenWeights: string
			metaKnowledge: string
			metaReleaseDate: string
			providerDocLink: string
			modelSearch: {
				placeholder: string
			}
		}
		prompts: {
			newFileName: string
		}
		buttons: {
			save: string
			delete: string
			setDefault: {
				tooltip: {
					dataset: {
						tip: string
					}
				}
				checkbox: {
					'aria-label': string
				}
			}
		}
		confirm: {
			unsavedChanges: string
			deleteFile: string
			unsavedChangesBeforeUnload: string
		}
		alerts: {
			fetchFileListFailed: string
			fetchGeneratorListFailed: string
			fetchDefaultsFailed: string
			fetchFileDataFailed: string
			fetchConfigTemplateFailed: string
			saveFileFailed: string
			deleteFileFailed: string
			addFileFailed: string
			setDefaultFailed: string
			fetchBranchesFailed: string
			noFileSelectedSave: string
			noFileSelectedDelete: string
			noGeneratorSelectedSave: string
			savedAsNewFile: string
			invalidFileName: string
		}
		achievements: {
			set_default_aisource: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			manage: {
				title: string
			}
		}
	}
	telegram_bots: {
		title: string
		description: string
		cardTitle: string
		botSelectDropdown: {
			placeholder: string
		}
		botSearch: {
			placeholder: string
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		configCard: {
			title: string
			labels: {
				character: string
				botToken: string
				config: string
			}
			botTokenInput: {
				placeholder: string
			}
			toggleBotTokenButton: {
				'aria-label': string
			}
			toggleBotTokenIcon: {
				alt: string
			}
			buttons: {
				saveConfig: string
				startBot: string
				stopBot: string
			}
			charSelect: {
				placeholder: string
			}
		}
		prompts: {
			newBotName: string
		}
		buttons: {
			newBot: string
			deleteBot: string
		}
		alerts: {
			configSaved: string
			botExists: string
			unsavedChanges: string
			httpError: string
			beforeUnload: string
		}
		achievements: {
			start_bot: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			bot_related: {
				title: string
				sub_items: {
					manage: {
						title: string
					}
				}
			}
		}
		home_char_interfaces: {
			configure: {
				title: string
			}
		}
	}
	wechat_bots: {
		title: string
		description: string
		cardTitle: string
		botSelectDropdown: {
			placeholder: string
		}
		botSearch: {
			placeholder: string
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		configCard: {
			title: string
			labels: {
				character: string
				apiBaseUrl: string
				botToken: string
				config: string
			}
			apiBaseUrlInput: {
				placeholder: string
			}
			botTokenInput: {
				placeholder: string
			}
			toggleBotTokenButton: {
				'aria-label': string
			}
			toggleBotTokenIcon: {
				alt: string
			}
			buttons: {
				saveConfig: string
				startBot: string
				stopBot: string
			}
			charSelect: {
				placeholder: string
			}
		}
		prompts: {
			newBotName: string
		}
		buttons: {
			newBot: string
			deleteBot: string
		}
		alerts: {
			configSaved: string
			botExists: string
			unsavedChanges: string
			httpError: string
			beforeUnload: string
		}
		achievements: {
			start_bot: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			bot_related: {
				title: string
				sub_items: {
					manage: {
						title: string
					}
				}
			}
		}
		home_char_interfaces: {
			configure: {
				title: string
			}
		}
		qrLogin: {
			hint: string
			button: string
			scanPrompt: string
			waiting: string
			scanned: string
			success: string
			needBot: string
		}
	}
	discord_bots: {
		title: string
		description: string
		cardTitle: string
		botSelectDropdown: {
			placeholder: string
		}
		botSearch: {
			placeholder: string
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		configCard: {
			title: string
			labels: {
				character: string
				apiKey: string
				config: string
			}
			apiKeyInput: {
				placeholder: string
			}
			toggleApiKeyButton: {
				'aria-label': string
			}
			toggleApiKeyIcon: {
				alt: string
			}
			buttons: {
				saveConfig: string
				startBot: string
				stopBot: string
			}
			charSelect: {
				placeholder: string
			}
		}
		prompts: {
			newBotName: string
		}
		buttons: {
			newBot: string
			deleteBot: string
		}
		alerts: {
			configSaved: string
			botExists: string
			unsavedChanges: string
			httpError: string
			beforeUnload: string
		}
		achievements: {
			start_bot: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			bot_related: {
				title: string
				sub_items: {
					manage: {
						title: string
					}
				}
			}
		}
		home_char_interfaces: {
			configure: {
				title: string
			}
		}
	}
	browser_integration: {
		title: string
		description: string
		pageHeader: string
		pageDescription: string
		install_script_title: string
		install_script_description: string
		install_button: string
		install_from_url_tip: string
		script_url_input: {
			'aria-label': string
		}
		what_is_manager: string
		manager_explanation: string
		popular_managers: string
		csp_warning: string
		connected_pages_title: string
		fetch_pages_error: string
		page_title: string
		page_url: string
		page_status: string
		status_focused: string
		status_unfocused: string
		copy_button: string
		copied_message: string
		no_pages_connected: {
			title: string
			description: string
		}
		autorun: {
			title: string
			description: string
			form_title: string
			comment_label: string
			url_regex_label: string
			script_label: string
			add_button: string
			list_title: string
			view_script_button: string
			delete_button: string
			confirm_delete: string
			add_success: string
			delete_success: string
			no_scripts: {
				title: string
				description: string
			}
			table: {
				comment: string
				url_regex: string
				created_at: string
			}
			view_script_modal_title: string
			view_script_modal_close_button: string
		}
		error: {
			load_failed: string
			add_failed: string
			delete_failed: string
		}
		achievements: {
			install_script: {
				name: string
				description: string
				locked_description: string
			}
			run_js: {
				name: string
				description: string
				locked_description: string
			}
			star_fount: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			integration_related: {
				title: string
				sub_items: {
					browserIntegrationLink: {
						title: string
					}
				}
			}
		}
	}
	browser_integration_script: {
		update: {
			prompt: string
		}
		csp_warning: string
		hostChange: {
			securityWarningTitle: string
			message: string
			uuidMismatchError: string
			verificationError: string
		}
	}
	terminal_assistant: {
		title: string
		description: string
		initialMessage: string
		initialMessageLink: string
		achievements: {
			invoke_shell_assist: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			integration_related: {
				title: string
				sub_items: {
					terminalAssist: {
						title: string
					}
				}
			}
		}
	}
	deskpet: {
		title: string
		description: string
		launcherCard: {
			title: string
			buttons: {
				start: string
			}
		}
		charSelectDropdown: {
			placeholder: string
		}
		charSearch: {
			placeholder: string
		}
		runningCard: {
			title: string
			noPets: string
			buttons: {
				stop: string
			}
		}
		toasts: {
			started: string
			stopped: string
			start_failed: string
			stop_failed: string
		}
		achievements: {
			start_deskpet: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_char_interfaces: {
			launch: {
				title: string
			}
		}
		home_function_buttons: {
			in_dev: {
				title: string
				sub_items: {
					deskpet_related: {
						title: string
						sub_items: {
							main: {
								title: string
							}
						}
					}
				}
			}
		}
	}
	access: {
		title: string
		description: string
		heading: string
		instruction: {
			sameLAN: string
			accessthis: string
		}
		QRcode: {
			alt: string
		}
		urlInput: {
			'aria-label': string
		}
		copyButton: string
		copied: string
		home_function_buttons: {
			main: {
				title: string
			}
		}
	}
	proxy: {
		title: string
		description: string
		heading: string
		instruction: string
		endpointSectionTitle: string
		endpointInstruction: string
		apiUrlInput: {
			'aria-label': string
		}
		usageExampleTitle: string
		usageExampleInstruction: string
		copyButton: string
		copied: string
		apiKeySectionTitle: string
		apiKey: string
		noApiKey: string
		generateApiKeyButton: string
		copyApiKeyButton: string
		apiKeyCopied: string
		queryStringSectionTitle: string
		queryStringWarning: string
		copyQueryStringUrlButton: string
		home_function_buttons: {
			other: {
				title: string
				sub_items: {
					asProxy: {
						title: string
					}
				}
			}
		}
	}
	ide_integration: {
		description: string
		title: string
		heading: string
		instruction: string
		supportedEditorsTitle: string
		supportedEditorsIntro: string
		supportedEditorsLoading: string
		supportedEditorsError: string
		acpTitle: string
		acpDesc: string
		acpCharLabel: string
		charListError: string
		acpScriptLabel: string
		acpConfigSample: string
		acpConfigHint: string
		copyButton: string
		copied: string
		apiKeySectionTitle: string
		apiKeyHint: string
		generateApiKeyButton: string
		apiKeyCopied: string
		apiKeyCreateError: string
		apiKeyInput: {
			'aria-label': string
		}
		home_function_buttons: {
			integration_related: string
			ide_integration_config: {
				title: string
			}
		}
		achievements: {
			first_ide_use: {
				name: string
				description: string
				locked_description: string
			}
		}
		acpChar: string
		acpConfig: string
	}
	achievements: {
		title: string
		description: string
		pageHeader: string
		pageDescription: string
		unlocked_on: string
		locked: string
		toast_title: string
		error: {
			load_failed: string
		}
		achievements: {
			open_achievements_page: {
				name: string
				description: string
				locked_description: string
			}
			relock_by_clicking: {
				name: string
				description: string
				locked_description: string
			}
		}
		home_function_buttons: {
			main: {
				title: string
			}
		}
	}
	log_viewer: {
		title: string
		description: string
		connectionError: string
		logs: {
			openSourceFailed: string
			toolbar: {
				clear: string
				filter: {
					placeholder: string
				}
			}
			levels: {
				all: string
				log: string
				info: string
				warn: string
				error: string
				debug: string
			}
		}
		repl: {
			input: {
				placeholder: string
			}
			hint: string
		}
	}
	debug_info: {
		title: string
		description: string
		heading: string
		copyButton: string
		versionStatus: {
			title: string
			checking: string
			local: string
			remote: string
			upToDate: string
			outdated: string
			checkFailed: string
		}
		systemInfo: {
			title: string
			failed: string
		}
		connectivity: {
			backend: string
			frontend: string
		}
		loading: string
		checking: string
		failed: string
		copySuccess: string
		copyFailed: string
		updateNow: string
		alreadyLatest: string
		updateRestarting: string
		updateSuccess: string
		updateFailed: string
		autoUpdateNotEnabled: string
		home_function_buttons: {
			debug: {
				main: {
					title: string
				}
			}
		}
	}
	badges_maker: {
		title: string
		description: string
		card_title: string
		original_url_label: string
		original_url: {
			placeholder: string
		}
		new_url_label: string
		new_url: {
			placeholder: string
		}
		preview_label: string
		copy_button: string
		copied_text: string
		preview: {
			alt: string
		}
		copy_error: string
		copy_fail_alert: string
	}
	'404': {
		title: string
		description: string
		pageNotFoundText: string
		homepageButton: string
	}
	tips: {
		title: string
	}
	directoryListing: {
		title: string
		description: string
		indexOf: string
		name: string
		mimeType: string
		size: string
		parentLink: string
	}
	code_block: {
		copy: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		copied: {
			dataset: {
				tip: string
			}
		}
		download: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		execute: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		preview: {
			dataset: {
				tip: string
			}
			'aria-label': string
		}
		copy_failed: string
	}
	pow_captcha: {
		initial: string
		verifying: string
		solved: string
		wasm_disabled: string
		error: string
		errorMessage: string
	}
	breadcrumb: {
		clickToNavigate: string
	}
	zxcvbn: {
		warnings: {
			straightRow: string
			keyPattern: string
			simpleRepeat: string
			extendedRepeat: string
			sequences: string
			recentYears: string
			dates: string
			topTen: string
			topHundred: string
			common: string
			similarToCommon: string
			wordByItself: string
			namesByThemselves: string
			commonNames: string
			userInputs: string
			pwned: string
		}
		suggestions: {
			l33t: string
			reverseWords: string
			allUppercase: string
			capitalization: string
			dates: string
			recentYears: string
			associatedYears: string
			sequences: string
			repeated: string
			longerKeyboardPattern: string
			anotherWord: string
			useWords: string
			noNeed: string
			pwned: string
		}
		timeEstimation: {
			ltSecond: string
			second: string
			seconds: string
			minute: string
			minutes: string
			hour: string
			hours: string
			day: string
			days: string
			month: string
			months: string
			year: string
			years: string
			centuries: string
		}
	}
	searchableDropdown: {
		trigger: {
			placeholder: string
		}
		search: {
			placeholder: string
		}
	}
	common: {
		cancel: string
		create: string
		save: string
		delete: string
		confirm: string
		close: string
		translate: {
			showOriginal: string
			showTranslation: string
		}
	}
	cabinet: {
		title: string
		description: string
		openCabinets: {
			title: string
			'aria-label': string
		}
		closeCabinets: {
			title: string
			'aria-label': string
		}
		bootstrapFailed: string
		home_function_buttons: {
			main: {
				title: string
			}
		}
		upload: string
		uploadFolder: string
		newFolder: string
		open: string
		download: string
		downloadZip: string
		rename: string
		copy: string
		cut: string
		paste: string
		pasteLink: string
		selectAll: string
		invert: string
		properties: string
		delete: string
		back: {
			title: string
			'aria-label': string
		}
		cancel: string
		save: string
		showHidden: string
		name: string
		descriptionField: string
		attrHidden: string
		attrSystem: string
		previewUrl: string
		deletePreviewWithFile: string
		folderPassword: string
		unlockFolder: string
		unlock: string
		unlockFailed: string
		previewFailed: string
		created: string
		modified: string
		statusCount: string
		newCabinetPrompt: string
		newFolderPrompt: string
		renamePrompt: string
		visibilityPrompt: string
		cabinetActionPrompt: string
		confirmDeleteCabinet: string
		confirmDelete: string
		confirmDeleteSystem: string
		copied: string
		cutDone: string
		undo: string
		redo: string
		newWindow: string
		goUp: string
		brokenLink: string
		noDownload: string
		groupDownloadHint: string
		remoteEntity: string
	}
	entityProfile: {
		attributionMismatch: string
		attributionMismatchShort: {
			title: string
			'aria-label': string
		}
		ownedBy: string
	}
}
// 用于从嵌套对象生成点表示法键的实用类型。
type Prev = [never, 0, 1, 2, 3, 4, 5, ...0[]]

type Paths<T, D extends number = 5> = [D] extends [never]
	? never
	: T extends object
		? { [K in keyof T]-?: K extends string | number
			? `${K}` | Join<K, Paths<T[K], Prev[D]>>
			: never
		}[keyof T]
		: ''

type Join<K, P> = K extends string | number
	? P extends string | number
		? `${K}${'' extends P ? '' : '.'}${P}`
		: never
	: never

/**
 * 表示语言环境数据所有可能的点表示法键。
 * 这为在 `geti18n` 中使用的键提供自动补全。
 *
 * @example
 * 'home.title'
 * 'login.errors.password_mismatch'
 */
export type LocaleKey = Paths<LocaleData>

/**
 * 将语言环境键映射到其预期参数对象的类型。
 * 如果键不需要参数，则不包含在此类型中。
 */
export type LocaleKeyParams = {
	'achievements.error.load_failed': { message: string | number }
	'achievements.unlocked_on': { date: string | number }
	'auth.error.accountLockedRetry': { timeLeft: string | number }
	'badges_maker.copy_error': { error: string | number }
	'breadcrumb.clickToNavigate': { path: string | number }
	'browser_integration.csp_warning': { browser: string | number; link: string | number }
	'browser_integration.error.add_failed': { message: string | number }
	'browser_integration.error.delete_failed': { message: string | number }
	'browser_integration.error.load_failed': { message: string | number }
	'browser_integration_script.hostChange.message': { newHost: string | number; origin: string | number }
	'browser_integration_script.hostChange.uuidMismatchError': { newHost: string | number }
	'browser_integration_script.hostChange.verificationError': { newHost: string | number }
	'cabinet.bootstrapFailed': { error: string | number }
	'cabinet.brokenLink': { reason: string | number }
	'cabinet.created': { stamp: string | number }
	'cabinet.modified': { stamp: string | number }
	'cabinet.previewFailed': { error: string | number }
	'cabinet.statusCount': { count: string | number; selected: string | number }
	'cabinet.unlockFailed': { error: string | number }
	'chat.dragAndDrop.charAdded': { partName: string | number }
	'chat.dragAndDrop.errorAddingPart': { error: string | number; partName: string | number }
	'chat.dragAndDrop.personaSet': { partName: string | number }
	'chat.dragAndDrop.pluginAdded': { partName: string | number }
	'chat.dragAndDrop.unsupportedPartType': { partType: string | number }
	'chat.dragAndDrop.worldSet': { partName: string | number }
	'chat.group.attachmentsHint': { n: string | number }
	'chat.group.auditLog.event.channel_create': { channelName: string | number }
	'chat.group.auditLog.event.channel_delete': { channelName: string | number }
	'chat.group.auditLog.event.channel_key_rotate': { channelName: string | number }
	'chat.group.auditLog.event.channel_permissions_update': { channelName: string | number }
	'chat.group.auditLog.event.channel_update': { channelName: string | number }
	'chat.group.auditLog.event.file_delete': { fileName: string | number }
	'chat.group.auditLog.event.file_upload': { fileName: string | number }
	'chat.group.auditLog.event.group_meta_update': { name: string | number }
	'chat.group.auditLog.event.member_ban': { target: string | number }
	'chat.group.auditLog.event.member_join': { target: string | number }
	'chat.group.auditLog.event.member_kick': { target: string | number }
	'chat.group.auditLog.event.member_unban': { target: string | number }
	'chat.group.auditLog.event.message_delete': { targetEventId: string | number }
	'chat.group.auditLog.event.peer_invite': { target: string | number }
	'chat.group.auditLog.event.pin_message': { channelName: string | number; targetEventId: string | number }
	'chat.group.auditLog.event.reputation_reset': { target: string | number }
	'chat.group.auditLog.event.reputation_slash': { claim: string | number; target: string | number }
	'chat.group.auditLog.event.role_assign': { roleName: string | number; target: string | number }
	'chat.group.auditLog.event.role_create': { roleName: string | number }
	'chat.group.auditLog.event.role_delete': { roleName: string | number }
	'chat.group.auditLog.event.role_revoke': { roleName: string | number; target: string | number }
	'chat.group.auditLog.event.role_update': { roleName: string | number }
	'chat.group.auditLog.event.unpin_message': { channelName: string | number; targetEventId: string | number }
	'chat.group.auditLog.loadFailed': { error: string | number }
	'chat.group.blockConfirm': { sender: string | number }
	'chat.group.feedbackDagLine': { label: string | number }
	'chat.group.feedbackDagLineWithNote': { label: string | number; note: string | number }
	'chat.group.feedbackPreviewLine': { note: string | number; sep: string | number; tag: string | number }
	'chat.group.feedbackPreviewTaggedNote': { note: string | number; tag: string | number }
	'chat.group.forceTriggerOne.title': { name: string | number }
	'chat.group.mentionHandle': { name: string | number }
	'chat.group.mentionInsert': { name: string | number }
	'chat.group.messageRefAnchor': { id: string | number }
	'chat.group.messageWithAttachments': { n: string | number; text: string | number }
	'chat.group.pinMessageLine': { targetId: string | number }
	'chat.group.quoteHeader': { sender: string | number; sep: string | number; time: string | number }
	'chat.group.quoteHeaderWithTime': { sender: string | number; time: string | number }
	'chat.group.quoteHeaderWithoutTime': { sender: string | number }
	'chat.group.remoteTyping': { name: string | number }
	'chat.group.remoteTypingMany': { count: string | number; name: string | number }
	'chat.group.remoteTypingTwo': { name1: string | number; name2: string | number }
	'chat.group.settingsPage.banConfirm': { name: string | number }
	'chat.group.settingsPage.banFailed': { error: string | number }
	'chat.group.settingsPage.channelArchiveImportFailed': { error: string | number }
	'chat.group.settingsPage.channelArchiveImportOk': { count: string | number }
	'chat.group.settingsPage.channelPermsUpdateFailed': { error: string | number }
	'chat.group.settingsPage.createRoleFailed': { error: string | number }
	'chat.group.settingsPage.deleteFailed': { error: string | number }
	'chat.group.settingsPage.deleteRoleFailed': { error: string | number }
	'chat.group.settingsPage.emojisDeleteFailed': { error: string | number }
	'chat.group.settingsPage.emojisUploadFailed': { error: string | number }
	'chat.group.settingsPage.gshGenerationNearLimit': { generation: string | number; maxGenerations: string | number }
	'chat.group.settingsPage.inviteClipboard': { code: string | number; groupId: string | number; url: string | number }
	'chat.group.settingsPage.inviteExpires': { date: string | number }
	'chat.group.settingsPage.keyRotateFailed': { error: string | number }
	'chat.group.settingsPage.kickConfirm': { name: string | number }
	'chat.group.settingsPage.kickFailed': { error: string | number }
	'chat.group.settingsPage.loadFailed': { error: string | number }
	'chat.group.settingsPage.ownerSuccessionFailed': { error: string | number }
	'chat.group.settingsPage.permissionUpdateFailed': { error: string | number }
	'chat.group.settingsPage.saveFailed': { error: string | number }
	'chat.group.settingsPage.unbanConfirm': { name: string | number }
	'chat.group.settingsPage.unbanFailed': { error: string | number }
	'chat.group.stickerPrefixLine': { label: string | number }
	'chat.group.threadBreadcrumbMiddleSummary': { count: string | number }
	'chat.group.unpinMessageLine': { targetId: string | number }
	'chat.group.voteBlockHeading': { prefix: string | number; question: string | number }
	'chat.group.voteBlockHeadingTagged': { question: string | number }
	'chat.group.voteCastLine': { choice: string | number; prefix: string | number }
	'chat.group.voteCastLineTagged': { choice: string | number }
	'chat.group.voteDeadlineLineClosed': { date: string | number }
	'chat.group.voteDeadlineLineOpen': { date: string | number }
	'chat.group.voteFor': { option: string | number }
	'chat.group.voteOptionsPreview': { options: string | number; prefix: string | number }
	'chat.group.voteOptionsPreviewTagged': { options: string | number }
	'chat.group.voteTotal': { n: string | number }
	'chat.hub.applyBranchFailed': { error: string | number }
	'chat.hub.autoBranchFailed': { error: string | number }
	'chat.hub.banners.forkTipScore': { score: string | number; short: string | number }
	'chat.hub.banners.forkTips': { count: string | number }
	'chat.hub.banners.gshBuffer': { total: string | number }
	'chat.hub.banners.mailboxPending': { count: string | number }
	'chat.hub.banners.quarantine': { count: string | number }
	'chat.hub.banners.suspectedRemoved': { count: string | number }
	'chat.hub.blockOpposingFailed': { error: string | number }
	'chat.hub.blockOpposingOk': { count: string | number }
	'chat.hub.callDuration': { duration: string | number }
	'chat.hub.callJoinFailed': { error: string | number }
	'chat.hub.callParticipants': { n: string | number }
	'chat.hub.callPeerCount': { n: string | number }
	'chat.hub.callScreenFailed': { error: string | number }
	'chat.hub.callStartedAt': { time: string | number }
	'chat.hub.channelContext.deleteConfirm': { name: string | number }
	'chat.hub.channelContext.exportFailed': { error: string | number }
	'chat.hub.charChatComposer.placeholder': { name: string | number }
	'chat.hub.charChatStart': { name: string | number }
	'chat.hub.charChatSubtitle': { name: string | number }
	'chat.hub.charChatsTitle': { name: string | number }
	'chat.hub.charCount': { count: string | number }
	'chat.hub.composer.placeholder': { channel: string | number }
	'chat.hub.configLoadFailed': { error: string | number }
	'chat.hub.configSaveFailed': { error: string | number }
	'chat.hub.createChatFailed': { error: string | number }
	'chat.hub.createModal.failed': { error: string | number }
	'chat.hub.deleteSessionConfirm': { name: string | number }
	'chat.hub.discoveryLoadFailed': { message: string | number }
	'chat.hub.discoverySourceCount': { count: string | number }
	'chat.hub.fedNonceRotated': { nonce: string | number }
	'chat.hub.fedRepairJoinSnapshotFailed': { error: string | number }
	'chat.hub.fedRepairJoinSnapshotOk': { channels: string | number }
	'chat.hub.federationLoadFailed': { error: string | number }
	'chat.hub.filesLoadFailed': { error: string | number }
	'chat.hub.filesRenameFolderPrompt': { name: string | number }
	'chat.hub.folderRenamePrompt': { name: string | number }
	'chat.hub.forkSplitFailed': { error: string | number }
	'chat.hub.friendsCount': { count: string | number }
	'chat.hub.friendsRestartConfirm': { name: string | number }
	'chat.hub.friendsRestartFailed': { error: string | number }
	'chat.hub.groupContext.leaveBatch': { count: string | number }
	'chat.hub.groupContext.leaveBatchOk': { count: string | number }
	'chat.hub.groupContext.leaveBatchPartial': { failed: string | number; total: string | number }
	'chat.hub.groupContext.leaveBatchPending': { count: string | number }
	'chat.hub.groupContext.leaveConfirm': { name: string | number }
	'chat.hub.groupContext.leaveConfirmBatch': { count: string | number }
	'chat.hub.groupContext.setAliasPrompt': { name: string | number }
	'chat.hub.groupUnnamed': { suffix: string | number }
	'chat.hub.gshDecryptPending': { gen: string | number }
	'chat.hub.inbox.badgeFetchFailed': { error: string | number }
	'chat.hub.inbox.jumpFailed': { error: string | number }
	'chat.hub.inbox.loadFailed': { error: string | number }
	'chat.hub.inbox.markSeenFailed': { error: string | number }
	'chat.hub.inbox.rowLabel.aria-label': { author: string | number; channel: string | number; group: string | number; preview: string | number }
	'chat.hub.inviteCardMembers': { count: string | number }
	'chat.hub.listJsonInvalid': { message: string | number }
	'chat.hub.loadGroupFailed': { error: string | number }
	'chat.hub.loadListFailed': { error: string | number }
	'chat.hub.loadMessagesFailed': { error: string | number }
	'chat.hub.memberContext.personalBlockConfirm': { name: string | number }
	'chat.hub.memberContext.setAliasPrompt': { name: string | number }
	'chat.hub.memberCountLabel': { count: string | number }
	'chat.hub.membersDigestMismatch': { root: string | number }
	'chat.hub.membersDigestOk': { root: string | number }
	'chat.hub.membersDigestOkPaged': { pages: string | number; root: string | number }
	'chat.hub.membersDigestPagesTitle.title': { expected: string | number; pages: string | number }
	'chat.hub.mergeDagFailed': { error: string | number }
	'chat.hub.messageActionFailed': { error: string | number }
	'chat.hub.newGroupWith': { name: string | number }
	'chat.hub.operationFailed': { error: string | number }
	'chat.hub.pinPreviewInvite': { groupName: string | number }
	'chat.hub.pinPreviewVote': { question: string | number }
	'chat.hub.profileEdit.linksPreview': { count: string | number }
	'chat.hub.profileEdit.resetFromPartFailed': { error: string | number }
	'chat.hub.profilePopup.dmFailed': { error: string | number }
	'chat.hub.profilePopup.setAliasPrompt': { name: string | number }
	'chat.hub.reactionRemovePrompt': { candidates: string | number; emoji: string | number }
	'chat.hub.reputationSlashAlert': { target: string | number }
	'chat.hub.saveEmojiFailed': { error: string | number }
	'chat.hub.saveStickerFailed': { error: string | number }
	'chat.hub.sendFailed': { error: string | number }
	'chat.hub.sendImageFailed': { error: string | number }
	'chat.hub.sendStickerFailed': { error: string | number }
	'chat.hub.sessionDeleteFailed': { error: string | number }
	'chat.hub.shareGroupFailed': { error: string | number }
	'chat.hub.startChatWith': { name: string | number }
	'chat.hub.stickersLoadFailed': { error: string | number }
	'chat.hub.streamAvJoinFailed': { error: string | number }
	'chat.hub.streamAvPeers': { count: string | number }
	'chat.hub.syncFailed': { error: string | number }
	'chat.hub.syncIncomplete': { missing: string | number; total: string | number }
	'chat.hub.timeToday': { time: string | number }
	'chat.hub.timeYesterday': { time: string | number }
	'chat.hub.translationPrefs.saveFailed': { error: string | number }
	'chat.hub.trustAuthorDialog.confirmCooldown': { seconds: string | number }
	'chat.hub.trustAuthorDialog.subtitle': { author: string | number }
	'chat.hub.typing': { names: string | number }
	'chat.hub.unbindFriendConfirm': { name: string | number }
	'chat.hub.unbindFriendFailed': { error: string | number }
	'chat.hub.voteCount': { count: string | number; pct: string | number }
	'chat.hub.voteCreateFailed': { error: string | number }
	'chat.hub.voteDeadline': { date: string | number }
	'chat.hub.voteTotal': { total: string | number }
	'chat.messageView.logprobsMetricsFooter': { speed: string | number; time: string | number; tokens: string | number; ttft: string | number }
	'chat.messageView.logprobsTopLogprobsMeta': { token: string | number }
	'chat.messageView.share.success': { provider: string | number; sponsorLink: string | number }
	'chat.messageView.toolOverridingFilepath': { filepath: string | number }
	'chat.messageView.toolReadingFilepath': { filepath: string | number }
	'chat.messageView.toolReplacingFilepath': { filepath: string | number }
	'chat.messageView.toolRunningLang': { lang: string | number }
	'chat.messageView.toolSearchingContent': { content: string | number }
	'chat.sessionSettings.subtitleRoles': { count: string | number }
	'chat.typingIndicator.isTyping': { names: string | number }
	'code_block.copy_failed': { error: string | number }
	'deskpet.toasts.start_failed': { charname: string | number; message: string | number }
	'deskpet.toasts.started': { charname: string | number }
	'deskpet.toasts.stop_failed': { charname: string | number; message: string | number }
	'deskpet.toasts.stopped': { charname: string | number }
	'directoryListing.indexOf': { path: string | number }
	'discord_bots.alerts.botExists': { botname: string | number }
	'easynew.alerts.error': { message: string | number }
	'easynew.alerts.success': { partName: string | number }
	'entityProfile.ownedBy': { owner: string | number }
	'export.alerts.exportFailed': { message: string | number }
	'export.alerts.loadPartDetailsFailed': { message: string | number }
	'export.alerts.shareFailed': { message: string | number }
	'fountConsole.auth.accountLockedLog': { username: string | number }
	'fountConsole.auth.logoutRefreshTokenProcessError': { error: string | number }
	'fountConsole.auth.refreshTokenError': { error: string | number }
	'fountConsole.auth.tokenVerifyError': { error: string | number }
	'fountConsole.botStarted': { botusername: string | number; charname: string | number; platform: string | number }
	'fountConsole.ipc.invokePartLog': { invokedata: string | number; partpath: string | number; username: string | number }
	'fountConsole.ipc.parseResponseFailed': { error: string | number }
	'fountConsole.ipc.processMessageError': { error: string | number }
	'fountConsole.ipc.runPartLog': { args: string | number; partpath: string | number; username: string | number }
	'fountConsole.ipc.sendCommandFailed': { error: string | number }
	'fountConsole.ipc.socketError': { error: string | number }
	'fountConsole.jobs.pausingJob': { partpath: string | number; uid: string | number; username: string | number }
	'fountConsole.jobs.preloadingParts': { count: string | number }
	'fountConsole.jobs.restartingJob': { partpath: string | number; uid: string | number; username: string | number }
	'fountConsole.partManager.git.noUpstream': { currentBranch: string | number }
	'fountConsole.partManager.git.uncommittedBackedUpTo': { path: string | number }
	'fountConsole.partManager.git.updateFailed': { error: string | number }
	'fountConsole.partManager.partInited': { partpath: string | number }
	'fountConsole.partManager.partLoaded': { partpath: string | number }
	'fountConsole.path.deno.patchUnsupportedArch': { arch: string | number }
	'fountConsole.path.git.backupSavedTo': { path: string | number }
	'fountConsole.path.git.noUpstreamBranch': { branch: string | number; remote: string | number }
	'fountConsole.path.git.remoteRefUnavailable': { ref: string | number }
	'fountConsole.path.install.packageFailed': { package: string | number }
	'fountConsole.path.install.permissionDeniedAsRoot': { path: string | number }
	'fountConsole.path.install.permissionDeniedNotRoot': { path: string | number }
	'fountConsole.path.protocol.registerFailed': { message: string | number }
	'fountConsole.path.remove.moduleRemoved': { module: string | number }
	'fountConsole.path.remove.removeBackgroundRunnerFailed': { message: string | number }
	'fountConsole.path.remove.removeDenoFailed': { message: string | number }
	'fountConsole.path.remove.removeModuleFailed': { message: string | number; module: string | number }
	'fountConsole.path.remove.removeProtocolHandlerFailed': { message: string | number }
	'fountConsole.path.remove.uninstallFountPwshFailed': { message: string | number }
	'fountConsole.path.shortcut.desktopShortcutCreated': { path: string | number }
	'fountConsole.path.shortcut.shortcutNotSupported': { os: string | number }
	'fountConsole.path.shortcut.startMenuShortcutCreated': { path: string | number }
	'fountConsole.path.terminalKeybindings.editorRemoved': { path: string | number }
	'fountConsole.path.terminalKeybindings.wtPatchFailed': { message: string | number; path: string | number }
	'fountConsole.path.terminalKeybindings.wtRemoved': { path: string | number }
	'fountConsole.route.setLanguagePreference': { preferredLanguages: string | number; username: string | number }
	'fountConsole.server.localUrl': { url: string | number }
	'fountConsole.server.mdns.bonjourFailed': { error: string | number }
	'fountConsole.server.mdns.failed': { error: string | number }
	'fountConsole.server.showUrl.http': { url: string | number }
	'fountConsole.server.showUrl.https': { url: string | number }
	'fountConsole.test.available': { ids: string | number }
	'fountConsole.test.blocked': { deps: string | number; label: string | number }
	'fountConsole.test.continueImperfect': { count: string | number }
	'fountConsole.test.denoPanic.alreadyReported': { signature: string | number }
	'fountConsole.test.denoPanic.detected': { label: string | number; signature: string | number }
	'fountConsole.test.denoPanic.duplicate': { upstream: string | number }
	'fountConsole.test.denoPanic.ghUnavailable': { signature: string | number }
	'fountConsole.test.denoPanic.publishFailed': { signature: string | number }
	'fountConsole.test.denoPanic.published': { url: string | number }
	'fountConsole.test.estimatedRemaining': { completed: string | number; eta: string | number; total: string | number }
	'fountConsole.test.estimatedRun': { eta: string | number; rate: string | number }
	'fountConsole.test.estimatedRunSerial': { eta: string | number }
	'fountConsole.test.estimatedRunSerialHint': { eta: string | number; rate: string | number; savings: string | number }
	'fountConsole.test.estimatedRunSkipped': { blocked: string | number; reused: string | number }
	'fountConsole.test.failed': { label: string | number }
	'fountConsole.test.failedWithCode': { code: string | number; label: string | number }
	'fountConsole.test.failuresCleared': { manifestId: string | number }
	'fountConsole.test.failuresSaved': { count: string | number; path: string | number }
	'fountConsole.test.federationCleanupPost': { output: string | number }
	'fountConsole.test.federationCleanupPre': { output: string | number }
	'fountConsole.test.heapSnapshotSaved': { path: string | number }
	'fountConsole.test.manifestMatched': { ids: string | number }
	'fountConsole.test.noRealRunPlanned': { blocked: string | number; reused: string | number }
	'fountConsole.test.nodeWorker.error': { error: string | number }
	'fountConsole.test.noiseHits': { hits: string | number }
	'fountConsole.test.noisyOnlyRemain': { count: string | number; suites: string | number }
	'fountConsole.test.outdatedSelected': { count: string | number }
	'fountConsole.test.passed': { label: string | number }
	'fountConsole.test.passedWithNoise': { label: string | number }
	'fountConsole.test.planSlotSummary': { blocked: string | number; reuse: string | number; run: string | number }
	'fountConsole.test.report.artifacts': { path: string | number }
	'fountConsole.test.report.continueReasonsLink': { path: string | number }
	'fountConsole.test.report.durationMs': { ms: string | number }
	'fountConsole.test.report.durationUnitDay': { n: string | number }
	'fountConsole.test.report.durationUnitHour': { n: string | number }
	'fountConsole.test.report.durationUnitMin': { n: string | number }
	'fountConsole.test.report.durationUnitMinute': { n: string | number }
	'fountConsole.test.report.durationUnitSec': { n: string | number }
	'fountConsole.test.report.estimatePoint': { eta: string | number }
	'fountConsole.test.report.labelPullDownstream': { requiredBy: string | number }
	'fountConsole.test.report.labelPullUpstream': { requiredBy: string | number }
	'fountConsole.test.report.pendingEstimate': { eta: string | number }
	'fountConsole.test.report.pendingItemExpected': { expected: string | number }
	'fountConsole.test.report.pendingParallelEstimate': { eta: string | number; rate: string | number }
	'fountConsole.test.report.pendingSavings': { savings: string | number }
	'fountConsole.test.report.progressFormat': { completed: string | number; total: string | number }
	'fountConsole.test.report.suitesFormat': { completed: string | number; passed: string | number }
	'fountConsole.test.reportPath': { path: string | number }
	'fountConsole.test.reportPathFinal': { path: string | number }
	'fountConsole.test.reusedSuite': { manifestId: string | number; name: string | number; status: string | number }
	'fountConsole.test.runningSuite.base': { manifestId: string | number; name: string | number }
	'fountConsole.test.runningSuite.expected': { expected: string | number }
	'fountConsole.test.selectedSuites': { selected: string | number; total: string | number }
	'fountConsole.test.silentPassedMany': { count: string | number }
	'fountConsole.test.speculativeDiscard': { deps: string | number; label: string | number }
	'fountConsole.test.state.artifacts': { path: string | number }
	'fountConsole.test.statePathFinal': { path: string | number }
	'fountConsole.test.suiteHeader': { name: string | number }
	'fountConsole.test.terminateDuration': { baseline: string | number; elapsed: string | number; label: string | number; limit: string | number }
	'fountConsole.test.terminateDurationDefault': { elapsed: string | number; label: string | number; limit: string | number }
	'fountConsole.test.terminateIdle': { elapsed: string | number; idleSec: string | number; label: string | number; minutes: string | number }
	'fountConsole.test.terminateMarker': { reason: string | number }
	'fountConsole.test.terminateSpeculative': { label: string | number }
	'fountConsole.test.terminateUnknown': { label: string | number }
	'fountConsole.test.terminated': { label: string | number; reason: string | number }
	'fountConsole.test.triggerNoMatch': { pattern: string | number; scope: string | number }
	'fountConsole.test.triggerNoMatchSummary': { count: string | number }
	'fountConsole.test.unknownFileFilter': { names: string | number; suite: string | number }
	'fountConsole.test.unknownManifestId': { ids: string | number }
	'fountConsole.test.unknownSubtestFilter': { names: string | number; suite: string | number }
	'fountConsole.test.unknownSuite': { name: string | number }
	'fountConsole.test.unknownSuiteSelector': { ids: string | number }
	'fountConsole.test.unsupportedSubtestFilter': { names: string | number; suite: string | number }
	'fountConsole.test.ws.fail': { detail: string | number }
	'fountConsole.test.ws.pass': { detail: string | number }
	'fountConsole.tray.createTrayFailed': { error: string | number }
	'fountConsole.tray.readIconFailed': { error: string | number }
	'fountConsole.verification.codeGeneratedLog': { code: string | number }
	'fountConsole.verification.codeNotifyBody': { code: string | number }
	'fountConsole.web.frontendFilesChanged': { path: string | number }
	'fountConsole.web.requestReceived': { method: string | number; url: string | number }
	'home.dragAndDrop.dropError': { error: string | number }
	'home.emptyList.message': { newpartLink: string | number; telegramLink: string | number }
	'ide_integration.apiKeyCreateError': { message: string | number }
	'ide_integration.supportedEditorsError': { message: string | number }
	'import.alerts.importFailed': { error: string | number }
	'import.errors.fileImportFailed': { message: string | number }
	'import.errors.textImportFailed': { message: string | number }
	'installer_wait_screen.feature4.description': { atlasCloudLink: string | number; evolinkLink: string | number }
	'installer_wait_screen.footer.error_message': { error: string | number }
	'log_viewer.logs.openSourceFailed': { message: string | number }
	'login_info.modal.retrieve_error': { error: string | number }
	'login_info.modal.transfer_error': { error: string | number }
	'part_config.alerts.loadEditorFailed': { message: string | number }
	'part_config.alerts.saveConfigFailed': { message: string | number }
	'pow_captcha.errorMessage': { error: string | number }
	'profile.errors.operationFailed': { error: string | number }
	'profile.federationSaveFailed': { error: string | number }
	'profile.groupMembers': { channels: string | number; members: string | number }
	'profile.ownerConfirmCooldown': { seconds: string | number }
	'profile.ownerSaveFailed': { error: string | number }
	'protocolhandler.offline_dialog.message': { hostUrl: string | number }
	'protocolhandler.runPart.commandError': { error: string | number }
	'protocolhandler.runPart.confirm.message': { partpath: string | number }
	'protocolhandler.unknownError': { error: string | number }
	'serviceSource_manager.alerts.addFileFailed': { error: string | number }
	'serviceSource_manager.alerts.deleteFileFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchBranchesFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchDefaultsFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchFileDataFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchFileListFailed': { error: string | number }
	'serviceSource_manager.alerts.fetchGeneratorListFailed': { error: string | number }
	'serviceSource_manager.alerts.saveFileFailed': { error: string | number }
	'serviceSource_manager.alerts.savedAsNewFile': { name: string | number }
	'serviceSource_manager.alerts.setDefaultFailed': { error: string | number }
	'serviceSource_manager.buttons.setDefault.checkbox.aria-label': { fileName: string | number }
	'serviceSource_manager.common_config_interface.currentModelTitle': { model: string | number; name: string | number }
	'serviceSource_manager.common_config_interface.loadModelsFailed': { message: string | number }
	'serviceSource_manager.common_config_interface.metaCachePrice': { read: string | number; write: string | number }
	'serviceSource_manager.common_config_interface.metaContext': { context: string | number }
	'serviceSource_manager.common_config_interface.metaInputPrice': { price: string | number }
	'serviceSource_manager.common_config_interface.metaKnowledge': { knowledge: string | number }
	'serviceSource_manager.common_config_interface.metaModalities': { input: string | number; output: string | number }
	'serviceSource_manager.common_config_interface.metaOutputLimit': { output: string | number }
	'serviceSource_manager.common_config_interface.metaOutputPrice': { price: string | number }
	'serviceSource_manager.common_config_interface.metaReleaseDate': { date: string | number }
	'serviceSource_manager.common_config_interface.modelsDevLoadFailed': { message: string | number }
	'serviceSource_manager.common_config_interface.providerDocLink': { url: string | number }
	'serviceSource_manager.common_config_interface.providerLabel': { provider: string | number }
	'social.actions.blockFailed': { error: string | number }
	'social.actions.deleteFailed': { error: string | number }
	'social.actions.dislikeFailed': { error: string | number }
	'social.actions.followFailed': { error: string | number }
	'social.actions.hideFailed': { error: string | number }
	'social.actions.likeFailed': { error: string | number }
	'social.actions.muteFailed': { error: string | number }
	'social.actions.replyFailed': { error: string | number }
	'social.actions.repostFailed': { error: string | number }
	'social.actions.saveFailed': { error: string | number }
	'social.bootstrapFailed': { error: string | number }
	'social.drafts.deleteFailed': { error: string | number }
	'social.drafts.loadFailed': { error: string | number }
	'social.drafts.saveFailed': { error: string | number }
	'social.feed.repostedBy': { author: string | number }
	'social.inbox.aggregated.follow': { author1: string | number; author2: string | number; count: string | number }
	'social.inbox.aggregated.followTwo': { author1: string | number; author2: string | number }
	'social.inbox.aggregated.like': { author1: string | number; author2: string | number; count: string | number }
	'social.inbox.aggregated.likeTwo': { author1: string | number; author2: string | number }
	'social.inbox.aggregated.repost': { author1: string | number; author2: string | number; count: string | number }
	'social.inbox.aggregated.repostTwo': { author1: string | number; author2: string | number }
	'social.live.likes': { n: string | number }
	'social.live.postEndedStats': { duration: string | number; likes: string | number; viewers: string | number }
	'social.live.viewers': { n: string | number }
	'social.notes.more': { n: string | number }
	'social.notifications.care_post': { author: string | number }
	'social.notifications.follow': { author: string | number }
	'social.notifications.like': { author: string | number }
	'social.notifications.live_started': { author: string | number }
	'social.notifications.mention': { author: string | number }
	'social.notifications.poll_closed': { author: string | number }
	'social.notifications.post_note': { author: string | number }
	'social.notifications.reply': { author: string | number }
	'social.notifications.repost': { author: string | number }
	'social.poll.deadline': { deadline: string | number }
	'social.profile.cabinetsFailed': { error: string | number }
	'social.reply.context': { author: string | number }
	'social.search.trustScore': { score: string | number }
	'social.taste.weight': { weight: string | number }
	'social.time.hoursAgo': { n: string | number }
	'social.time.minutesAgo': { n: string | number }
	'social.trending.postCount.title': { n: string | number }
	'stickers.authorLabel': { author: string | number }
	'stickers.stickerCount': { count: string | number }
	'subfounts.codeExecution.executionFailed': { message: string | number }
	'subfounts.codeExecution.hostOption': { id: string | number }
	'subfounts.codeExecution.subfountOption': { deviceId: string | number; id: string | number }
	'subfounts.connectedSubfounts.descriptionSaveFailed': { message: string | number }
	'subfounts.errors.generalError': { message: string | number }
	'subfounts.errors.loadConnectionCodeFailed': { message: string | number }
	'subfounts.errors.loadSettingsFailed': { message: string | number }
	'subfounts.errors.regenerateConnectionCodeFailed': { message: string | number }
	'subfounts.errors.saveSettingsFailed': { message: string | number }
	'telegram_bots.alerts.botExists': { botname: string | number }
	'themeManage.editor.deleteConfirm': { id: string | number }
	'themeManage.editor.failedToClone': { message: string | number }
	'themeManage.editor.failedToDelete': { message: string | number }
	'themeManage.editor.mjsSyntaxHint': { asyncDocLink: string | number }
	'tutorial.progressMessages.keyboardPress': { keyboardIcon: string | number }
	'tutorial.progressMessages.mobileClick': { phoneIcon: string | number }
	'tutorial.progressMessages.mobileTouchMove': { phoneIcon: string | number }
	'tutorial.progressMessages.mouseMove': { mouseIcon: string | number }
	'uninstall.alerts.failed': { error: string | number }
	'uninstall.alerts.httpError': { status: string | number }
	'uninstall.alerts.success': { name: string | number; type: string | number }
	'uninstall.confirmMessage': { name: string | number; type: string | number }
	'uninstall.titleWithName': { name: string | number; type: string | number }
	'userSettings.apiError': { message: string | number }
	'userSettings.apiKeys.keyDetails': { createdAt: string | number; description: string | number; lastUsed: string | number }
	'userSettings.deleteAccount.confirmMessage2': { username: string | number }
	'userSettings.editorCommand.presetOptionPathAvailable': { label: string | number }
	'userSettings.editorCommand.presetOptionPathUnavailable': { label: string | number }
	'userSettings.generalError': { message: string | number }
	'userSettings.passkeys.itemDetails': { created: string | number }
	'userSettings.renameUser.moveFailed': { detail: string | number }
	'userSettings.renameUser.success': { newUsername: string | number }
	'userSettings.userDevices.deviceDetails': { ipAddress: string | number; lastSeen: string | number; userAgent: string | number }
	'userSettings.userDevices.deviceInfo': { deviceId: string | number }
	'wechat_bots.alerts.botExists': { botname: string | number }
}

/**
 * 表示所有需要参数的语言环境键的类型。
 */
export type LocaleKeyWithParams = keyof LocaleKeyParams

/**
 * 表示所有不需要参数的语言环境键的类型。
 */
export type LocaleKeyWithoutParams = Exclude<LocaleKey, LocaleKeyWithParams>
