// 此文件由本地化文件自动生成。
// 请勿手动编辑此文件，因为它将被覆盖。
// 此文件为 i18n 键提供类型定义，实现自动补全。

/**
 * 表示所有可能的语言环境数据类型。
 */
export type LocaleData = {
	lang: string
	name: string
	tips: {
		title: string
		data: string[]
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
			watchNoGroups: string
			updateEstimates: {
				incompatible: string
				summary: string
			}
			kernel: {
				incompatible: string
				unknownAction: string
				alreadyDown: string
				stopped: string
				rebooted: string
			}
			skipBecause: {
				pass: string
				fail: string
			}
			moduleCheck: {
				missedReady: string
			}
			queue: {
				append: string
				remove: string
			}
			display: {
				eta: string
				etaUnknown: string
				explicitSelectedCount: string
				reason: string
				remaining: string
				remainingUnknown: string
				remainingOnlyUnknown: string
				queued: LocaleSwitchLeaf
				failureLog: string
			}
			passed: string
			passedWithNoise: string
			failed: string
			failedWithCode: string
			passedLabel: string
			failedLabel: string
			noiseHits: string
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
			skippedTree: string
			speculativeDiscard: string
			continueDefault: string
			continueImperfect: string
			outdatedSelected: string
			runningSuite: {
				base: string
				speculative: string
				heavy: string
				expected: string
			}
			reusedSuite: string
			prunedAbsentState: string
			noisyOnlyRemain: string
			noRealRunPlanned: string
			allReusedHint: string
			failuresSaved: string
			failuresCleared: string
			terminated: string
			sleepDetected: string
			sleepRetry: string
			nothingToContinue: string
			triggerNoMatch: string
			triggerNoMatchSummary: string
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
				estimatePoint: string
				commandDefault: string
				exitPassed: string
				exitFailed: string
				exitInProgress: string
				progressFormat: string
				suitesFormat: string
				artifacts: string
				columnSuite: string
				columnDuration: string
				continueReasonsLink: string
				deadTriggersHint: string
				durationMs: string
				durationUnit: {
					day: string
					hour: string
					min: string
					minute: string
					sec: string
				}
				section: {
					continue: string
					continueReasons: string
					deadTriggers: string
					failed: string
					noisyPassed: string
					pending: string
					replay: string
					replayImperfect: string
					silentPassed: string
					skipped: string
					skipTree: string
				}
				pending: {
					estimate: string
					itemExpected: string
				}
				reason: {
					dependencyRequired: string
					explicitSelected: string
					imperfect: {
						blocked: string
						dependent: string
						failed: string
						noisy: string
					}
					missingRecord: string
					staleContent: string
					skipBecause: string
					triggerHashDrift: string
				}
				label: {
					commitRange: string
					continueReason: string
					directRequiredBy: string
					duration: string
					expectedBlocked: string
					failedFiles: string
					gateReason: string
					inclusionPath: string
					log: string
					matchedPaths: string
					matchedTriggerSets: string
					matchedTriggers: string
					noise: string
					pullDownstream: string
					pullUpstream: string
					reused: string
					rootCause: string
					skipBecause: string
					skipBecauseClosed: string
					skipTree: string
					terminateReason: string
					triggerHashDrift: string
					uncommittedHashRange: string
				}
				field: {
					command: string
					duration: string
					estimatedRemaining: string
					exit: string
					failed: string
					noisyPassed: string
					parallelRate: string
					progress: string
					reused: string
					runId: string
					suiteSumDuration: string
					suites: string
					wallClock: string
				}
			}
			state: {
				title: string
				artifacts: string
				sectionDependencyTree: string
				sectionOverview: string
				sectionBlocked: string
				labelBlockedBy: string
				statusUnknown: string
				statusOutdated: string
				column: {
					blocked: string
					commit: string
					duration: string
					log: string
					ranAt: string
					status: string
					suite: string
				}
			}
			terminate: {
				duration: string
				durationDefault: string
				idle: string
				marker: string
				speculative: string
				unknown: string
			}
			unknown: {
				fileFilter: string
				manifestId: string
				subtestFilter: string
				suite: string
				suiteSelector: string
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
				switchingToBranch: string
				switchingToRemote: string
				removedNoUpdate: string
				pinningToCommit: string
				pinningToPullRequest: string
				createdNoUpdate: string
				unknownTarget: string
			}
			version: {
				branch: {
					title: string
					detached: string
				}
				commit: string
				remote: string
				status: {
					title: string
					upToDate: string
					behind: string
					ahead: string
					diverged: string
					detachedNoCompare: string
					fetchFailed: string
				}
				autoUpdatePaused: string
				noRepo: string
				noGit: string
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
			steam: {
				registering: string
				registered: string
				failed: string
				exeFailed: string
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
				upstreamGoneFallbackMaster: string
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
			eula: {
				prompt: string
				yn: string
				required: string
				declined: string
				statusServerFailed: string
			}
			install: {
				installingDependencies: string
				compilingFavicon: string
				packageFailed: string
				browserMissing: string
				untrustedPartsWarning: string
				permissionDeniedAsRoot: string
				permissionDeniedNotRoot: string
				rootWarningAsRoot: string
				rootWarningPreferUser: string
				runnerUpdating: string
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
				fountUninstallationComplete: string
				fountInstallationDirRemoved: string
				protocolHandlerRemoved: string
				fountPwshRemovedFromProfile: string
				pwshProfileNotFound: string
				uninstallFountPwshFailed: string
				terminalProfileRemoved: string
				terminalProfileNotFound: string
				desktopShortcutRemoved: string
				desktopShortcutNotFound: string
				startMenuShortcutRemoved: string
				startMenuShortcutNotFound: string
				steamShortcutRemoved: string
				steamShortcutNotFound: string
				moduleRemoved: string
				uninstalling: {
					chrome: string
					deno: string
					fountPwsh: string
					git: string
					winget: string
				}
				removing: {
					backgroundRunner: string
					desktopShortcut: string
					fount: {
						main: string
						fromGitSafeDir: string
						fromPath: string
						installationDir: string
						pwshFromProfile: string
					}
					installedPwshModules: string
					installedSystemPackages: string
					protocolHandler: string
					startMenuShortcut: string
					steamShortcut: string
					terminalKeybindings: string
					terminalProfile: string
				}
				remove: {
					backgroundRunnerFailed: string
					denoFailed: string
					moduleFailed: string
					protocolHandlerFailed: string
				}
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
			slowInstallHint: string
			playWhileWaiting: string
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
			adjectives: string[]
			nouns: string[]
			platforms: string[]
		}
		utm_welcome: {
			title: string
			message: string
			dismiss: string
		}
		cool_notice: {
			region: {
				'aria-label': string
			}
			badge: string
			lede: string
			punchline: string
			nudge: string
			dismiss: string
		}
		eula: {
			title: string
			agree: string
			continue: string
			continue_in: string
			language: {
				'aria-label': string
			}
			loading: string
			load_failed: string
		}
		footer: {
			ready_text: string
			wait_text: string
			open_fount: string
			open_or_install_fount: string
			error_message: string
			star_thank_you: string
			telegram: {
				title: string
				'aria-label': string
			}
			github: {
				title: string
				'aria-label': string
			}
		}
		error: {
			title: string
			description: string
			connection_failed: string
			close_page: string
			summary: string
			retryHint: string
		}
		features: {
			seamlessChat: {
				title: string
				description: string
			}
			customUi: {
				title: string
				description: string
			}
			expressiveChat: {
				title: string
				description: string
			}
			aiSources: {
				title: string
				description: string
			}
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
			verificationCode: {
				error: string
				rateLimit: string
				sendError: string
				sent: string
			}
		}
		webauthn: {
			loginButton: string
			apiSessionExpired: string
			apiUnknownPasskey: string
			apiPasskeyVerificationFailed: string
			removeUserNotFound: string
			removeInvalidPassword: string
			removePasskeyNotFound: string
			registration: {
				failed: string
				sessionExpired: string
				userNotFound: string
				verifyFailed: string
			}
			error: {
				authSessionRequired: string
				badBeginResponse: string
				cancelled: string
				credentialRequired: string
				loadLibrary: string
				sessionMissing: string
			}
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
	home: {
		title: string
		description: string
		sidebarTitle: string
		closeSidebar: string
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
			shells: {
				title: string
				subtitle: string
				card: {
					defaultCheckbox: {
						title: string
					}
				}
			}
			service: {
				generators: {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'generators/AI': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'generators/search': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'generators/translate': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				sources: {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'sources/AI': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'sources/search': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'sources/translate': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'generators/SpeechRecognition': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
					}
				}
				'sources/SpeechRecognition': {
					title: string
					subtitle: string
					card: {
						defaultCheckbox: {
							title: string
						}
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
			pickerTitle: {
				'aria-label': string
				textContent: string
			}
			recent: {
				title: string
				'aria-label': string
			}
			jumpToStart: {
				title: string
				'aria-label': string
			}
			jumpToUnicode: {
				title: string
				'aria-label': string
			}
			discoverPacks: string
			addToCollection: string
			addedToCollection: string
			joinGroup: string
			alreadyMember: string
			followAuthor: string
			alreadyFollowing: string
			followSuccess: string
			openAuthor: string
			previewGroupMeta: string
			previewAuthorMeta: string
			previewActionFailed: string
			loadFailed: string
			category: {
				animal: string
				face: string
				food: string
				gesture: string
				heart: string
				object: string
			}
		}
		emojiPacks: {
			title: string
			kicker: string
			description: string
			back: string
			loading: string
			empty: string
			loadFailed: string
			preview: string
			joinGroup: string
			followAuthor: string
			sourceGroup: string
			sourceAuthor: string
			itemCount: string
		}
		unicodeEmojiGroups: {
			Smileys_and_Emotion: {
				title: string
				'aria-label': string
			}
			People_and_Body: {
				title: string
				'aria-label': string
			}
			Animals_and_Nature: {
				title: string
				'aria-label': string
			}
			Food_and_Drink: {
				title: string
				'aria-label': string
			}
			Travel_and_Places: {
				title: string
				'aria-label': string
			}
			Activities: {
				title: string
				'aria-label': string
			}
			Objects: {
				title: string
				'aria-label': string
			}
			Symbols: {
				title: string
				'aria-label': string
			}
			Flags: {
				title: string
				'aria-label': string
			}
		}
		sessionSettings: {
			unnamedTitle: string
			modeGroup: string
			modeSingle: string
			modeEmpty: string
			subtitleRoles: string
			saveSuccess: string
			saveFailed: string
			status: {
				dirty: string
				saveFailed: string
				saved: string
				saving: string
			}
		}
		group: {
			defaults: {
				groupMetaName: string
				defaultChannelName: string
				dmChatName: string
				dmDmName: string
				threadName: string
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
				col: {
					actor: string
					summary: string
					time: string
					type: string
				}
			}
			membersEmpty: string
			channelEncryptionGsh: string
			e2eDecryptUnavailable: string
			contentRefBodyPending: string
			contentRefHashMismatch: string
			convergentEncryptWarn: string
			dagForkDetected: string
			mergeDagTips: string
			mergeDagTipsOk: string
			mergeDagTipsFailed: string
			channelsTitle: string
			members: string
			membersHint: string
			loadError: string
			messagesLoadFailed: string
			sendFailed: string
			chatNotLoaded: string
			newGroupName: string
			trustAuthor: {
				textContent: string
				title: string
			}
			trustAuthorOk: string
			listEmpty: string
			listChannelReadonly: {
				placeholder: string
			}
			mentionHandle: string
			mentionInsert: string
			attachmentsHint: string
			copied: string
			addBookmark: {
				title: string
			}
			bookmarkExists: string
			bookmarkAdded: string
			bookmarkSaveFailed: string
			localAiLabel: string
			forceTriggerOne: {
				title: string
			}
			forceTriggerAllLocal: string
			forceTriggerAllLocalTitle: {
				title: string
			}
			quoteHeader: string
			quoteHeaderWithTime: string
			quoteHeaderWithoutTime: string
			stopGenerating: string
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
			convertToText: string
			convertToList: string
			setAsDefault: string
			isDefault: string
			channelUpdateFailed: string
			record: string
			fileDownload: {
				title: string
			}
			unknownFile: string
			blockSender: {
				title: string
			}
			blockConfirm: string
			blockAdded: string
			saveSticker: {
				title: string
			}
			deleteMessage: {
				title: string
			}
			deleteConfirm: string
			saveEdit: string
			cancelEdit: string
			editingMessage: string
			groupNameLabel: string
			groupName: {
				placeholder: string
			}
			moreActions: {
				title: string
			}
			shareExternalOk: string
			shareExternalFailed: string
			ownerSuccession: {
				main: string
				autoSignHint: string
				candidateLabel: string
				description: string
				needHash: string
				selfButton: string
			}
			channelType: {
				label: string
				list: string
				streaming: string
				text: string
			}
			settings: {
				archive: {
					adminOnly: string
					colChannel: string
					colMonth: string
					colSize: string
					delete: {
						before: string
						button: string
						confirm: string
						failed: string
						hint: string
						invalidMonth: string
						ok: string
					}
					empty: string
					filesTitle: string
					hint: string
					title: string
				}
				autoChannelGc: string
				autoChannelGcHint: string
				autoReply: {
					frequency: string
					frequencyHint: string
					tokenBucket: string
					tokenBucketHint: string
				}
				batterySaver: string
				compactTriggerDepth: string
				discoveryBlurb: string
				discoveryPublic: string
				discoveryTitle: string
				eventRetentionDepth: string
				eventRetentionMs: string
				explorePeers: string
				fedPartition: string
				fedTuningHint: string
				fileCe: {
					mode: string
					modeConvergent: string
					modeHint: string
					modeRandom: string
				}
				gossipTtl: string
				hlcMaxSkew: string
				hotLatest: string
				hotWindowHint: string
				ice: {
					cred: {
						'aria-label': string
						placeholder: string
					}
					remove: {
						'aria-label': string
					}
					servers: string
					serversAdd: string
					serversHint: string
					url: {
						'aria-label': string
						placeholder: string
					}
					user: {
						'aria-label': string
						placeholder: string
					}
				}
				maxDagPayload: string
				maxPeers: string
				message: {
					rateLimit: string
					retention: string
					retention1y: string
					retention30d: string
					retention90d: string
					retentionForever: string
					retentionHint: string
				}
				page: {
					title: string
					description: string
					kicker: string
					subtitle: string
					backToChat: string
					navigationLabel: string
					activeEmojiPackLabel: string
					membersTitle: string
					overviewTitle: string
					overviewHint: string
					governanceHint: string
					governanceDenied: string
					rolesDenied: string
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
					allowDangerousHtml: string
					save: string
					loadFailed: string
					saveSuccess: string
					saveFailed: string
					rolesTitle: string
					rolesHint: string
					roleDefault: string
					permissionUpdated: string
					permissionUpdateFailed: string
					noMembers: string
					memberRoles: string
					ban: string
					banConfirm: string
					banSuccess: string
					banFailed: string
					bannedTitle: string
					unban: string
					unbanConfirm: string
					unbanSuccess: string
					unbanFailed: string
					gshGenerationRetentionHint: string
					gshGenerationNearLimit: string
					ownerSuccession: string
					ownerSuccessionOk: string
					ownerSuccessionFailed: string
					defaultEmojiPack: {
						failed: string
						hint: string
						label: string
						ok: string
					}
					channelArchive: {
						hint: string
						import: string
						importFailed: string
						importOk: string
						title: string
					}
					channelPerms: {
						denied: string
						hint: string
						overridden: string
						clearOverride: string
						noChannels: string
						selectChannel: string
						stateAllow: string
						stateDeny: string
						stateNeutral: string
						updateFailed: string
						updated: string
					}
					advanced: {
						description: string
						hubDescription: string
						hubTitle: string
						navigationLabel: string
						title: string
					}
					emojis: {
						create: {
							pack: string
							packFailed: string
							packOk: string
							packPrompt: string
						}
						delete: string
						deleteConfirm: string
						deleteFailed: string
						deleteOk: string
						empty: string
						hint: string
						packGroupOption: string
						title: string
						upload: string
						uploadFailed: string
						uploadOk: string
					}
					invite: {
						clipboard: string
						code: string
						copied: string
						copy: string
						copyFailed: string
						expires: string
						groupId: string
						hint: string
						mint: string
						title: string
					}
					delete: {
						confirm: string
						failed: string
						group: string
						role: string
						roleConfirm: string
						roleFailed: string
						roleSuccess: string
						success: string
					}
					create: {
						role: string
						roleFailed: string
						rolePrompt: string
						roleSuccess: string
					}
					perm: {
						ADD_REACTIONS: string
						ADMIN: string
						BAN_MEMBERS: string
						BYPASS_RATE_LIMIT: string
						CREATE_THREADS: string
						INVITE_MEMBERS: string
						KICK_MEMBERS: string
						MANAGE_CHANNELS: string
						MANAGE_FILES: string
						MANAGE_MESSAGES: string
						MANAGE_ROLES: string
						MANAGE_ADMINS: string
						PIN_MESSAGES: string
						SEND_MESSAGES: string
						SEND_STICKERS: string
						STREAM: string
						UPLOAD_FILES: string
						VIEW_CHANNEL: string
					}
					kick: {
						main: string
						confirm: string
						failed: string
						selfNodeWarning: string
						success: string
					}
					tabs: {
						advanced: string
						audit: string
						channelPermissions: string
						emojis: string
						general: string
						members: string
						permissions: string
						storage: string
					}
					key: {
						managementTip: string
						managementTitle: string
						rotate: string
						rotateConfirm: string
						rotateFailed: string
						rotateOk: string
					}
				}
				pinContext: string
				rtcBudget: string
				rtcJoinRate: string
				streamGeneratingIdle: string
				streamingSfu: string
				trustedPeers: string
				wantIdsBudget: string
			}
			feedback: {
				dagLine: string
				dagLineWithNote: string
				down: string
				previewLine: string
				previewTaggedNote: string
				up: string
			}
			message: {
				aborted: string
				deleted: string
				deletedBracket: string
				prefixSticker: string
				refAnchor: string
				withAttachments: string
			}
			default: {
				channel: {
					placeholder: string
				}
				channelLabel: string
				channelSet: string
				channelSetFailed: string
			}
			sticker: {
				defaultName: string
				prefixLine: string
				prefixLineTagged: string
				saved: string
			}
			remote: {
				nodeTimeout: string
				typing: string
				typingMany: string
				typingTwo: string
				unavailable: string
				unsafe: string
			}
			create: {
				channelFailed: string
				failed: string
				group: string
				groupFailed: string
				groupTitle: string
			}
			stream: {
				generationFailed: string
				noEmbed: {
					textContent: string
				}
				noSfu: {
					textContent: string
				}
				ok: string
				test: string
			}
			unpin: {
				action: {
					textContent: string
					title: string
				}
				message: string
				messageLine: string
				ok: string
			}
			vote: {
				blockHeading: string
				blockHeadingTagged: string
				cast: string
				castLine: string
				castLineTagged: string
				create: string
				createFailed: string
				deadline: string
				deadlineLineClosed: string
				deadlineLineOpen: string
				ended: string
				for: string
				optionsPreview: string
				optionsPreviewTagged: string
				promptDeadline: string
				tooFewOptions: string
				total: string
			}
			edit: {
				cancel: string
				confirm: string
				emptyText: string
				hint: string
				message: {
					title: string
				}
			}
			menu: {
				copyId: string
				copyText: string
				exportHtml: string
				shareExternal: string
			}
			pin: {
				action: {
					textContent: string
					title: string
				}
				failed: string
				message: string
				messageLine: string
				ok: string
				thisMessage: string
			}
			av: {
				mute: string
				needStreamChannel: string
				start: string
				stop: string
				swap: string
			}
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
			inboxTooltip: {
				title: string
				tip: string
			}
			inbox: {
				title: string
				panel: {
					'aria-label': string
				}
				filtersLabel: {
					'aria-label': string
				}
				rowLabel: {
					'aria-label': string
				}
				sidebarHint: string
				badgeFetchFailed: string
				loadFailed: string
				markSeenFailed: string
				jumpFailed: string
				empty: {
					careDescription: string
					careTitle: string
					mentionDescription: string
					mentionTitle: string
					messageDescription: string
					messageTitle: string
					voteDescription: string
					voteTitle: string
				}
				tabs: {
					care: string
					mention: string
					message: string
					voteClosed: string
				}
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
			prefsTooltip: {
				title: string
				tip: string
			}
			prefsSubtitle: string
			prefsNav: {
				'aria-label': string
			}
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
				'aria-label': string
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
			uploadTitle: {
				title: string
			}
			emojiTitle: {
				title: string
			}
			shareGroupTitle: {
				title: string
			}
			shareGroupOk: string
			inviteJoinButton: string
			inviteLinkNeedsRoomSecret: string
			inviteCardMembers: string
			attachmentLoadFailed: string
			timeToday: string
			timeYesterday: string
			stickerTitle: {
				title: string
			}
			stopGenerateTitle: {
				title: string
			}
			confirmDeleteLong: string
			forceReply: string
			removeChar: string
			newGroupWith: string
			meAuthor: string
			feedbackReasonPrompt: string
			feedbackReasonInput: {
				placeholder: string
			}
			recentEmojiTab: {
				title: string
			}
			recentEmojisEmpty: string
			currentGroupEmojiTab: {
				title: string
			}
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
			changeStatusTitle: {
				'aria-label': string
			}
			aboutSection: string
			bioEmpty: string
			banners: {
				gshBuffer: string
				plaintextSidecar: string
				quarantine: string
				mailboxPending: string
				syncing: string
				archiveCoverageIncomplete: string
				archiveSyncButton: string
				applyBranch: string
				autoBranch: string
				mergeDag: string
				splitFork: string
				blockOpposing: string
				suspectedRemoved: string
				suspectedRemovedKeep: string
				suspectedRemovedLeave: string
				fork: {
					governance: string
					tipLabel: string
					tipScore: string
					tips: string
				}
			}
			applyBranchOk: string
			applyBranchFailed: string
			autoBranchOk: string
			autoBranchFailed: string
			revealRemoteMd: string
			composer: {
				placeholder: string
			}
			composerSuspectedRemoved: {
				placeholder: string
			}
			adminSection: string
			copyEntityId: string
			copyEntityIdOk: string
			remoteBadge: {
				textContent: string
				title: string
			}
			trustAuthor: {
				textContent: string
				title: string
			}
			stickerInline: string
			markdownRenderFailed: string
			messageRenderFailed: string
			retrySend: string
			mergeDagOk: string
			mergeDagFailed: string
			typing: string
			charsHeader: string
			settingsModalTitle: string
			modalClose: string
			cancel: string
			bookmarkLocal: string
			groupsSection: string
			ungrouped: string
			defaultCategory: string
			bookmarkFallback: string
			bookmarkRemove: {
				title: string
				'aria-label': string
			}
			unreadDivider: string
			backToFriends: string
			dmTopicsTitle: string
			participants: string
			startChatWith: string
			loading: string
			createChatFailed: string
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
			quickActions: string
			advancedSettings: string
			advancedSettingsDescription: string
			dangerZone: string
			deleteSessionDescription: string
			deleteSession: string
			deleteSessionConfirm: string
			reactionRemovePrompt: string
			ariaDagTip: {
				'aria-label': string
			}
			ariaClose: {
				'aria-label': string
			}
			serverBar: {
				'aria-label': string
			}
			operationFailed: string
			warmCharCacheFailed: string
			shareGroupFailed: string
			replyInline: {
				title: string
			}
			replyClear: {
				title: string
			}
			replyInThread: {
				title: string
			}
			localMaterializedView: string
			convergentEncryptWarn: string
			reputationSlashAlert: string
			profileEdit: {
				close: {
					'aria-label': string
				}
				previewHint: string
				sfwMode: string
				livePreview: string
				languageVersion: string
				localeHint: string
				themeColor: {
					clear: string
					hint: string
				}
				linksPreview: string
				unsavedHint: string
				tagsLabel: string
				tagAdd: string
				tagRemove: {
					'aria-label': string
				}
				linksLabel: string
				handleLabel: string
				handleHint: string
				newLocale: {
					placeholder: string
				}
				renameLocale: {
					'aria-label': string
				}
				localeRemove: {
					'aria-label': string
				}
				avatarUrl: {
					placeholder: string
				}
				avatarUpload: {
					'aria-label': string
				}
				tag: {
					placeholder: string
				}
				handle: {
					placeholder: string
				}
				resetFrom: {
					part: string
					partConfirm: string
					partDone: string
					partFailed: string
				}
				banner: {
					clear: string
					hint: string
					label: string
					upload: {
						'aria-label': string
					}
					url: {
						placeholder: string
					}
				}
				link: {
					add: string
					name: {
						placeholder: string
					}
					remove: {
						'aria-label': string
					}
					url: {
						placeholder: string
					}
				}
			}
			profilePopup: {
				'aria-label': string
				close: {
					title: string
				}
				editSaved: string
				editQueued: string
				noFedIdentity: string
				peerNoIdentity: string
				care: string
				careRemove: string
				setAlias: string
				setAliasPrompt: string
				dm: {
					char: string
					failed: string
					user: string
				}
			}
			gshDecryptPending: string
			gshDecryptFailed: string
			reactionFailed: string
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
				cancel: string
				submit: string
				failed: string
				join: {
					inviteOnly: string
					inviteOnlyDescription: string
					pow: string
					powDescription: string
					section: string
				}
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
			myGroups: string
			joinGroup: string
			createGroup: string
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
			altImage: {
				placeholder: string
				label: string
			}
			editedLabel: string
			mentionEmpty: string
			mentionSuggest: {
				'aria-label': string
			}
			clickToLoad: string
			serverActionPicker: {
				create: string
				createDescription: string
				join: string
				joinDescription: string
				subtitle: string
				title: string
			}
			membersDigest: {
				fetchFailed: string
				mismatch: string
				ok: string
				okPaged: string
				pagesTitle: {
					title: string
				}
				pending: string
			}
			unbindFriend: {
				main: string
				confirm: string
				description: string
				failed: string
				ok: string
			}
			federation: {
				loadFailed: string
				rebindFailed: string
				subtitle: string
				title: string
				tooltip: {
					title: string
					tip: string
				}
			}
			newChannel: {
				button: string
				failed: string
				success: string
				title: string
			}
			discovery: {
				description: string
				empty: string
				emptyTitle: string
				eyebrow: string
				join: string
				loadFailed: string
				noDescription: string
				open: string
				refresh: string
				sidebarHint: string
				sourceCount: string
				title: string
				tooltip: {
					title: string
					tip: string
				}
			}
			forkSplit: {
				failed: string
				modalSubmit: string
				modalTitle: string
				prompt: string
			}
			stickers: {
				empty: string
				loadFailed: string
				loading: string
				manage: string
				marketLink: string
				panelTitle: string
			}
			friends: {
				contextNewChat: string
				count: string
				emptyAction: string
				emptyDescription: string
				emptyTitle: string
				header: string
				restartConfirm: string
				restartFailed: string
				restartOk: string
				search: {
					placeholder: string
					chat: string
					dm: string
					empty: string
					localChar: string
					pin: string
					tooShort: string
				}
				tag: string
				tooltip: {
					title: string
					tip: string
				}
			}
			channel: {
				bar: {
					'aria-label': string
				}
				context: {
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
				name: string
				nameInput: {
					placeholder: string
				}
				readonlyList: {
					placeholder: string
				}
				readonlyStream: {
					placeholder: string
				}
				type: string
				typeList: string
				typeStreaming: string
				typeText: string
			}
			message: {
				action: {
					bookmark: {
						title: string
					}
					copyHtml: {
						title: string
					}
					delete: {
						title: string
					}
					edit: {
						title: string
					}
					failed: string
					noPermission: string
					feedbackDown: {
						title: string
					}
					feedbackUp: {
						title: string
					}
					next: {
						title: string
					}
					pin: {
						title: string
					}
					prev: {
						title: string
					}
					regen: {
						title: string
					}
					unpin: {
						title: string
					}
				}
				context: {
					edit: string
					delete: string
				}
				edit: {
					area: {
						'aria-label': string
					}
					cancel: string
					save: string
					upload: {
						title: string
						'aria-label': string
					}
					hint: string
					emptyText: string
				}
				feedbackSubmit: string
				input: {
					placeholder: string
					'aria-label': string
				}
				prefixVote: string
			}
			session: {
				deleteFailed: string
				deleted: string
				id: string
				info: string
				messages: string
				role: string
			}
			folder: {
				collapse: string
				default: string
				dissolve: string
				expand: string
				rename: string
				renamePrompt: string
			}
			stream: {
				av: {
					join: string
					joinFailed: string
					leave: string
					mute: string
					noCodecs: string
					peers: string
					preset: {
						high: string
						low: string
						med: string
						thumb: string
					}
					unmute: string
					video: string
					videoOn: string
					you: string
				}
				defaultName: string
				embedHttpsRequired: string
				refreshToken: string
				tokenFailed: string
				webRtcHint: string
			}
			member: {
				bar: {
					'aria-label': string
				}
				context: {
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
				countLabel: string
				joined: string
				section: string
			}
			thread: {
				close: {
					title: string
				}
				composer: {
					placeholder: string
				}
				createFailed: string
				created: string
				drawer: {
					'aria-label': string
				}
				breadcrumb: {
					'aria-label': string
				}
			}
			config: {
				loadFailed: string
				saveFailed: string
				saved: string
				title: string
			}
			statusItems: {
				dnd: {
					title: string
					textContent: string
				}
				idle: {
					title: string
					textContent: string
				}
				offline: {
					title: string
					textContent: string
				}
				online: {
					title: string
					textContent: string
				}
			}
			files: {
				bindCabinet: string
				delete: string
				deleteConfirm: string
				deleteFolderConfirm: string
				download: string
				drawerTitle: string
				empty: string
				foldersTitle: string
				listTitle: string
				loadFailed: string
				loading: string
				newFolder: string
				newFolderPrompt: string
				no: {
					cabinets: string
					channel: string
					folders: string
					group: string
				}
				rename: string
				renameFolderPrompt: string
				rootFolder: string
				title: {
					title: string
				}
				upload: string
				uploadTo: string
			}
			group: {
				context: {
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
					leave: {
						main: string
						batch: string
						batchOk: string
						batchPartial: string
						batchPending: string
						confirm: string
						confirmBatch: string
						ok: string
					}
				}
				descriptionEmpty: string
				emojiTab: {
					title: string
				}
				emojisEmpty: string
				emojisLoadFailed: string
				headerMenu: {
					title: string
				}
				joinRequired: string
				tag: string
				unnamed: string
			}
			block: {
				author: {
					title: string
				}
				authorTitle: string
				confirm: string
				ok: string
				opposingConfirm: string
				opposingFailed: string
				opposingOk: string
			}
			call: {
				button: {
					title: string
					'aria-label': string
				}
				duration: string
				ended: string
				hangup: string
				inProgress: string
				join: string
				joinFailed: string
				jumpBack: string
				noParticipants: string
				participants: string
				peerCount: string
				screenFailed: string
				screenShare: string
				screenStop: string
				startedAt: string
			}
			vote: {
				closed: string
				count: string
				createFailed: string
				deadline: string
				minOptions: string
				modalSubmit: string
				modalTitle: string
				noOptions: string
				optionDefault: string
				promptDeadlineHours: string
				promptOptions: string
				promptQuestion: string
				title: {
					title: string
				}
				total: string
			}
			file: {
				decryptFailed: string
				downloadFailed: string
				loadFailed: string
				noKey: string
				skippedDedup: string
				uploadChecking: string
				uploadFailed: string
				uploadRegistering: string
				uploaded: string
				uploadingChunk: string
			}
			menu: {
				copy: string
				delete: string
				download: string
				hTML: string
				mD: string
				next: string
				prev: string
				share: {
					'1h': string
					'12h': string
					'24h': string
					'72h': string
				}
				shareGroup: string
				tXT: string
			}
			char: {
				chat: {
					composer: {
						placeholder: string
					}
					empty: string
					settings: string
					start: string
					subtitle: string
				}
				chatsTitle: string
				count: string
				descriptionEmpty: string
				intro: string
				streaming: string
				tag: string
				tagSolo: string
				typing: string
			}
			list: {
				channelEmpty: string
				editorTitle: string
				itemUntitled: string
				jsonInvalid: string
				saveFailed: string
				saveToDag: string
				saved: string
			}
			save: {
				emoji: {
					title: string
				}
				emojiFailed: string
				emojiOk: string
				sticker: {
					title: string
				}
				stickerFailed: string
				stickerOk: string
			}
			sync: {
				failed: string
				incomplete: string
				noPeers: string
				rateLimited: string
				truncated: string
				truncatedHint: string
			}
			load: {
				charChatFailed: string
				groupFailed: string
				listFailed: string
				messagesFailed: string
				more: string
			}
			send: {
				main: string
				failed: string
				failedPending: string
				imageFailed: string
				stickerFailed: string
				title: {
					title: string
				}
			}
			fed: {
				advancedDescription: string
				advancedTitle: string
				batterySaverLabel: string
				batterySaverTip: string
				connectionTitle: string
				dm: {
					invalidateDescription: string
					invalidateTitle: string
					issueLabel: string
					issued: string
					linkDescription: string
					linkTip: string
					linkTitle: string
					needPubKey: string
					needSecretKey: string
					nodeLabel: string
					pubKeyLabel: string
					rotateConfirm: string
					rotateLabel: string
					secretLabel: string
					urlLabel: string
				}
				groupRecoveryTip: string
				groupRecoveryTitle: string
				nonceRotated: string
				relayUrlsLabel: string
				relayUrlsTip: string
				repEmpty: string
				repTip: string
				repTitle: string
				repairJoinSnapshot: string
				repairJoinSnapshotFailed: string
				repairJoinSnapshotOk: string
				resetOk: string
				resetSubmitLabel: string
				rotateRoomSecret: string
				rotateRoomSecretConfirm: string
				rotateRoomSecretOk: string
				saved: string
				slash: {
					claimLabel: string
					needHash: string
					ok: string
					proof: {
						placeholder: string
					}
					proofLabel: string
					submitLabel: string
					target: {
						placeholder: string
					}
					targetLabel: string
					tip: string
					title: string
					verifiedLabel: string
				}
			}
			pin: {
				previewInvite: string
				previewSticker: string
				previewVote: string
				unpinSidebar: {
					title: string
				}
			}
			no: {
				activeChat: string
				bookmarks: string
				channels: string
				chars: string
				description: string
				friends: string
				groups: string
				members: string
				pins: string
			}
			trustedAuthorBadge: {
				textContent: string
				title: string
			}
			attachment: {
				dropToUpload: string
			}
			unreadBadge: {
				'aria-label': string
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
		voiceRecording: {
			errorAccessingMicrophone: string
			confirmSpeechRecognition: string
			speechRecognitionFailed: string
		}
		attachment: {
			buttons: {
				download: {
					title: string
					'aria-label': string
				}
				edit: {
					title: string
					'aria-label': string
				}
				editIcon: {
					alt: string
				}
				delete: {
					title: string
					'aria-label': string
				}
				more: {
					title: string
					'aria-label': string
				}
				recognize: {
					title: string
					'aria-label': string
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
		profile: {
			title: string
			description: string
			settingsEyebrow: string
			accountAtGlance: string
			advancedKicker: string
			advancedSettings: string
			advancedDescription: string
			cardHost: {
				'aria-label': string
			}
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
			groupDescriptionEmpty: string
			groupMembers: string
			channelPrivate: string
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
			channelType: {
				list: string
				streaming: string
				text: string
				voice: string
			}
			federation: {
				advanced: string
				batterySaverLabel: string
				description: string
				relayUrlsLabel: string
				resetDefault: string
				resetOk: string
				save: string
				saveFailed: string
				saved: string
				summary: string
				title: string
			}
			summary: {
				accountStatus: string
				emailVisibility: string
				languagePref: string
				linksCount: string
				socialCount: string
				themePref: string
				userId: string
			}
			owner: {
				clear: string
				cleared: string
				confirm: {
					cancel: string
					cooldown: string
					editBody: string
					first: string
					renderBody: string
					second: string
					title: string
					warningTitle: string
				}
				description: string
				entityHash: {
					placeholder: string
				}
				entityHashLabel: string
				save: string
				saveFailed: string
				saved: string
				summary: string
				title: string
			}
		}
		entityProfile: {
			attributionMismatch: string
			attributionMismatchShort: {
				title: string
				'aria-label': string
			}
			ownedBy: string
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
			searchLabel: string
			emptyPacks: string
			tagsLabel: string
			tags: {
				placeholder: string
			}
			author: string
			authorLabel: string
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
			sticker: {
				count: string
				name: {
					placeholder: string
				}
				nameLabel: string
				nameRequired: string
			}
			select: {
				image: string
				pack: string
				packOption: {
					textContent: string
				}
				packRequired: string
			}
			pack: {
				description: {
					placeholder: string
				}
				descriptionLabel: string
				name: {
					placeholder: string
				}
				nameLabel: string
			}
		}
		message: {
			edit: {
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
			generating: {
				tips: string
				stop: {
					textContent: string
					title: string
				}
				stopIcon: {
					alt: string
				}
			}
			list: {
				confirmDeleteMessage: string
			}
			view: {
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
					copy: {
						html: string
						htmlIcon: {
							alt: string
						}
						markdown: string
						markdownIcon: {
							alt: string
						}
						text: string
						textIcon: {
							alt: string
						}
					}
				}
				share: {
					uploading: string
					success: string
				}
				commonToolCalling: string
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
				tool: {
					overridingFilepath: string
					readingFilepath: string
					replacingFilepath: string
					runningLang: string
					searchingContent: string
				}
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
			persona: {
				appearance: {
					label: string
					placeholder: string
				}
				def: {
					heading: string
				}
				personality: {
					label: string
					placeholder: string
				}
				userName: {
					label: string
					placeholder: string
				}
			}
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
		jsonEditor: {
			'aria-label': string
		}
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
			oauth: {
				login: string
				logout: string
				loggedIn: string
				notLoggedIn: string
				waiting: string
				failed: string
				deviceCode: string
				credentialsRequired: string
			}
			copyModelIdTooltip: string
			loadModelsFailed: string
			modelSearchTitle: string
			modelSearchHint: string
			modelsDevLoading: string
			modelsDevLoadFailed: string
			noModelsMatched: string
			currentModelTitle: string
			providerLabel: string
			providerDocLink: string
			modelSearch: {
				placeholder: string
			}
			meta: {
				cachePrice: string
				context: string
				inputPrice: string
				knowledge: string
				modalities: string
				openWeights: string
				outputLimit: string
				outputPrice: string
				reasoning: string
				releaseDate: string
				toolCall: string
				vision: string
			}
		}
		platforms: {
			bedrock: {
				credentialsRequired: string
			}
			vertex: {
				credentialsRequired: string
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
			saveFileFailed: string
			deleteFileFailed: string
			addFileFailed: string
			setDefaultFailed: string
			noFileSelectedSave: string
			noFileSelectedDelete: string
			noGeneratorSelectedSave: string
			savedAsNewFile: string
			invalidFileName: string
			fetch: {
				branchesFailed: string
				configTemplateFailed: string
				defaultsFailed: string
				fileDataFailed: string
				fileListFailed: string
				generatorListFailed: string
			}
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
			jsonEditor: {
				'aria-label': string
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
			confirmDeleteBot: string
			invalidJsonConfig: string
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
			jsonEditor: {
				'aria-label': string
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
			jsonEditor: {
				'aria-label': string
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
	social: {
		title: string
		description: string
		bootstrapFailed: string
		connectNodeFailed: string
		dwellFailed: string
		home_function_buttons: {
			main: {
				title: string
			}
		}
		nav: {
			side: {
				'aria-label': string
			}
			mobile: {
				'aria-label': string
			}
			feed: {
				'aria-label': string
				title: string
			}
			explore: {
				'aria-label': string
				title: string
			}
			notifications: {
				'aria-label': string
				title: string
			}
			saved: {
				'aria-label': string
				title: string
			}
			drafts: {
				'aria-label': string
				title: string
			}
			profile: {
				'aria-label': string
				title: string
			}
			videos: {
				'aria-label': string
				title: string
			}
			live: {
				'aria-label': string
				title: string
			}
			compose: {
				'aria-label': string
			}
		}
		settings: {
			title: string
			loadFailed: string
			back: {
				'aria-label': string
			}
			privacyTitle: string
			privacyHint: string
			tasteTitle: string
			tasteHint: string
			autoTranslateTitle: string
			autoTranslateHint: string
			autoTranslateEnable: string
			safetyTitle: string
			safetyHint: string
			mutedKeywords: {
				placeholder: string
				'aria-label': string
				add: string
				empty: string
				hint: string
				matchTags: string
				remove: {
					title: string
				}
				title: string
			}
			taste: {
				rebuild: string
				empty: string
				weight: string
				save: string
				name: {
					placeholder: string
				}
				privacyPublish: {
					preferences: string
					preferencesHint: string
					reactions: string
					reactionsHint: string
				}
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
		}
		composer: {
			placeholder: string
			locale: {
				'aria-label': string
			}
			'aria-label': string
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
			scheduleLabel: string
			scheduleSuccess: string
			emojiButton: {
				title: string
				'aria-label': string
			}
			mentionSuggest: {
				'aria-label': string
			}
			mediaButton: string
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
			visibility: {
				label: string
				public: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				unlisted: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				followers: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				followers7d: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				followers30d: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				selected: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				private: {
					title: string
					'aria-label': string
					label: string
					textContent: string
				}
				allowLabel: string
				exceptLabel: string
				allow: {
					placeholder: string
				}
				except: {
					placeholder: string
				}
				'aria-label': string
			}
			reply: {
				displayAll: string
				displayFeaturedOnly: string
				displayLabel: string
				policy: {
					authorFollows: string
					everyone: string
					followers7d: string
					label: string
				}
			}
			voiceButton: {
				title: string
				'aria-label': string
			}
			voiceFailed: string
			audioTranscript: {
				placeholder: string
			}
			confirmSpeechRecognition: string
			speechRecognitionFailed: string
		}
		feed: {
			refresh: {
				'aria-label': string
				title: string
				dataset: {
					tip: string
				}
			}
			loadFailed: string
			newPosts: string
			tabsLabel: {
				'aria-label': string
			}
			tabLatest: string
			tabForYou: string
			repostedBy: string
			decryptFailed: string
			revealContent: string
			sensitiveMedia: string
			showMore: string
			showLess: string
			replayDivider: string
			trending: {
				title: string
				postCount: {
					textContent: string
					title: string
				}
				empty: string
				'aria-label': string
			}
		}
		explore: {
			accounts: string
			loadFailed: string
			posts: string
			mediaOnly: string
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
			loadFailed: string
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
			folderSelect: {
				'aria-label': string
			}
			confirm: string
			cancel: string
			remove: {
				title: string
				'aria-label': string
			}
			renameFolder: {
				title: string
				'aria-label': string
			}
			renameFolderPrompt: string
			deleteFolder: {
				title: string
				'aria-label': string
			}
			deleteFolderConfirm: string
			searchEmpty: string
			folderEmpty: string
			emptyHint: string
			loadFailed: string
			search: {
				placeholder: string
			}
		}
		drafts: {
			untitled: string
			emptyHint: string
			saved: string
			deleted: string
			delete: {
				title: string
				'aria-label': string
			}
			empty: string
			saveFailed: string
			loadFailed: string
			deleteFailed: string
		}
		profile: {
			edit: string
			loadFailed: string
			viewPosts: string
			settingsBtn: {
				'aria-label': string
			}
			mediaOnly: string
			hideFromExplore: string
			tabsLabel: {
				'aria-label': string
			}
			cabinetsEmpty: string
			cabinetsFailed: string
			followingTitle: string
			followersTitle: string
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
			stats: {
				followers: string
				following: string
				group: {
					'aria-label': string
				}
				posts: string
			}
			tabs: {
				albums: string
				cabinets: string
				likes: string
				posts: string
			}
		}
		video: {
			view: {
				'aria-label': string
			}
			empty: string
			emptyHint: string
			loadFailed: string
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
			loadFailed: string
			joinFailed: string
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
				media: {
					audio: string
					av: string
					video: string
					whip: string
				}
			}
			danmaku: {
				placeholder: string
			}
		}
		search: {
			placeholder: string
			'aria-label': string
			open: {
				'aria-label': string
			}
			submit: string
			clear: {
				'aria-label': string
			}
			empty: string
			tooShort: string
			usersTitle: string
			postsTitle: string
			usersEmpty: string
			pinAlias: string
			trustScore: string
			viewTitle: string
			loading: string
			loadFailed: string
			sortRecent: string
			sortPopular: string
			scopeLocal: string
			scopeNearby: string
			filter: {
				author: {
					placeholder: string
					'aria-label': string
				}
				media: {
					'aria-label': string
				}
				mediaAll: string
				mediaImage: string
				mediaVideo: string
				scope: {
					'aria-label': string
				}
				sort: {
					'aria-label': string
				}
				tag: {
					placeholder: string
					'aria-label': string
				}
			}
		}
		dialog: {
			close: {
				'aria-label': string
			}
		}
		actions: {
			like: {
				title: string
				'aria-label': string
			}
			unlike: {
				title: string
				'aria-label': string
			}
			dislike: {
				title: string
				'aria-label': string
			}
			undislike: {
				title: string
				'aria-label': string
			}
			repost: string
			quote: string
			delete: string
			edit: string
			save: {
				title: string
				'aria-label': string
			}
			saved: {
				title: string
				'aria-label': string
			}
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
			exportMediaFailed: string
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
			deadlineLabel: string
			options: {
				placeholder: string
			}
		}
		aside: {
			region: {
				'aria-label': string
			}
			suggested: string
		}
		groupRef: {
			linking: string
			clear: string
			pick: string
			select: {
				'aria-label': string
			}
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
			loadFailed: string
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
	}
	cabinet: {
		title: string
		description: string
		entries: {
			title: string
			'aria-label': string
		}
		breadcrumb: {
			'aria-label': string
		}
		openCabinets: string
		closeCabinets: string
		bootstrapFailed: string
		home_function_buttons: {
			main: {
				title: string
			}
		}
		upload: string
		uploadFolder: string
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
		goUp: string
		brokenLink: string
		noDownload: string
		groupDownloadHint: string
		remoteEntity: string
		new: {
			cabinet: {
				title: string
				'aria-label': string
			}
			cabinetPrompt: string
			folder: string
			folderPrompt: string
			window: string
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
	ide_integration: {
		description: string
		title: string
		heading: string
		instruction: string
		charListError: string
		copyButton: string
		copied: string
		generateApiKeyButton: string
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
		supportedEditors: {
			error: string
			intro: string
			loading: string
			title: string
		}
		apiKey: {
			copied: string
			createError: string
			hint: string
			input: {
				'aria-label': string
			}
			sectionTitle: string
		}
		acp: {
			char: string
			charLabel: string
			config: string
			configHint: string
			configSample: string
			desc: string
			scriptLabel: string
			title: string
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
			listNotFound: string
			deviceNotFound: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
			revoke: {
				button: string
				confirm: string
				missingParams: string
				success: string
				wrongPassword: string
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
			keyNotFound: string
			verifyMissingApiKey: string
			errorDescriptionRequired: string
			createSuccess: string
			refreshButton: {
				title: string
			}
			refreshButtonIcon: {
				alt: string
			}
			revoke: {
				button: string
				confirm: string
				missingJti: string
				missingPassword: string
				success: string
				wrongPassword: string
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
			saveButton: string
			saveSuccess: string
			test: {
				button: string
				pathInput: {
					placeholder: string
				}
				pathRequired: string
				success: string
				lineInput: {
					'aria-label': string
				}
				columnInput: {
					'aria-label': string
				}
			}
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
			usernameMismatch: string
			success: string
			missingPassword: string
			wrongPassword: string
			confirmWarning: string
			confirmUsernamePrompt: string
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
		usageExampleTitle: string
		usageExampleInstruction: string
		copyButton: string
		copied: string
		noApiKey: string
		generateApiKeyButton: string
		copyApiKeyButton: string
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
		api: {
			key: string
			keyCopied: string
			keySectionTitle: string
			urlInput: {
				'aria-label': string
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
			unlock_failed: string
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
		testStatus: {
			title: string
			running: string
			idle: string
			queued: string
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
		alreadyLatest: string
		autoUpdateNotEnabled: string
		home_function_buttons: {
			debug: {
				main: {
					title: string
				}
			}
		}
		update: {
			failed: string
			now: string
			restarting: string
			success: string
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
	directoryListing: {
		title: string
		description: string
		indexOf: string
		name: string
		mimeType: string
		size: string
		parentLink: string
	}
	util: {
		toast: {
			container: {
				'aria-label': string
			}
		}
		imageEditor: {
			apply: string
			brush: string
			brushColor: {
				title: string
				'aria-label': string
			}
			brushSize: {
				title: string
				'aria-label': string
			}
			crop: string
			image: string
			mosaic: string
		}
		common: {
			cancel: string
			create: string
			save: string
			delete: string
			confirm: string
			close: string
			translate: {
				label: string
				showOriginal: string
				showTranslation: string
			}
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
		mediaViewer: {
			dialog: {
				'aria-label': string
			}
			download: {
				textContent: string
				'aria-label': string
			}
			close: {
				textContent: string
				'aria-label': string
			}
			prev: {
				'aria-label': string
			}
			next: {
				'aria-label': string
			}
		}
	}
	oauth_handler: {
		title: string
		description: string
		callback: {
			working: string
			success: string
			failed: string
			missingParams: string
		}
	}
}
/**
 * i18n switch 叶子（singular / plural 等），由 geti18n 按 params[switch] 解析。
 */
export type LocaleSwitchLeaf = {
	switch: string
	default: string | LocaleSwitchLeaf
	cases?: { [key: string]: string | LocaleSwitchLeaf }
}
// 用于从嵌套对象生成点表示法键的实用类型。
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, ...0[]]

type Paths<T, D extends number = 8> = [D] extends [never]
	? never
	: T extends LocaleSwitchLeaf
		? ''
		: T extends readonly (infer ArrayElement)[]
		? `${number}` | Join<`${number}`, Paths<ArrayElement, Prev[D]>>
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
	'achievements.error.unlock_failed': { error: string | number }
	'achievements.unlocked_on': { date: string | number }
	'auth.error.accountLockedRetry': { timeLeft: string | number }
	'badges_maker.copy_error': { error: string | number }
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
	'chat.emoji.loadFailed': { error: string | number }
	'chat.emoji.previewActionFailed': { error: string | number }
	'chat.emoji.previewGroupMeta': { name: string | number }
	'chat.emojiPacks.itemCount': { count: string | number }
	'chat.emojiPacks.loadFailed': { error: string | number }
	'chat.entityProfile.ownedBy': { owner: string | number }
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
	'chat.group.feedback.dagLine': { label: string | number }
	'chat.group.feedback.dagLineWithNote': { label: string | number; note: string | number }
	'chat.group.feedback.previewLine': { note: string | number; sep: string | number; tag: string | number }
	'chat.group.feedback.previewTaggedNote': { note: string | number; tag: string | number }
	'chat.group.forceTriggerOne.title': { name: string | number }
	'chat.group.mentionHandle': { name: string | number }
	'chat.group.mentionInsert': { name: string | number }
	'chat.group.message.refAnchor': { id: string | number }
	'chat.group.message.withAttachments': { n: string | number; text: string | number }
	'chat.group.pin.messageLine': { targetId: string | number }
	'chat.group.quoteHeader': { sender: string | number; sep: string | number; time: string | number }
	'chat.group.quoteHeaderWithTime': { sender: string | number; time: string | number }
	'chat.group.quoteHeaderWithoutTime': { sender: string | number }
	'chat.group.remote.typing': { name: string | number }
	'chat.group.remote.typingMany': { count: string | number; name: string | number }
	'chat.group.remote.typingTwo': { name1: string | number; name2: string | number }
	'chat.group.settings.archive.delete.confirm': { month: string | number }
	'chat.group.settings.archive.delete.failed': { error: string | number }
	'chat.group.settings.archive.delete.ok': { files: string | number }
	'chat.group.settings.page.banConfirm': { name: string | number }
	'chat.group.settings.page.banFailed': { error: string | number }
	'chat.group.settings.page.channelArchive.importFailed': { error: string | number }
	'chat.group.settings.page.channelArchive.importOk': { count: string | number }
	'chat.group.settings.page.channelPerms.updateFailed': { error: string | number }
	'chat.group.settings.page.create.roleFailed': { error: string | number }
	'chat.group.settings.page.delete.failed': { error: string | number }
	'chat.group.settings.page.delete.roleFailed': { error: string | number }
	'chat.group.settings.page.emojis.create.packFailed': { error: string | number }
	'chat.group.settings.page.emojis.deleteFailed': { error: string | number }
	'chat.group.settings.page.emojis.packGroupOption': { packId: string | number }
	'chat.group.settings.page.emojis.uploadFailed': { error: string | number }
	'chat.group.settings.page.gshGenerationNearLimit': { generation: string | number; maxGenerations: string | number }
	'chat.group.settings.page.invite.clipboard': { code: string | number; groupId: string | number; url: string | number }
	'chat.group.settings.page.invite.expires': { date: string | number }
	'chat.group.settings.page.key.rotateFailed': { error: string | number }
	'chat.group.settings.page.kick.confirm': { name: string | number }
	'chat.group.settings.page.kick.failed': { error: string | number }
	'chat.group.settings.page.loadFailed': { error: string | number }
	'chat.group.settings.page.ownerSuccessionFailed': { error: string | number }
	'chat.group.settings.page.permissionUpdateFailed': { error: string | number }
	'chat.group.settings.page.saveFailed': { error: string | number }
	'chat.group.settings.page.unbanConfirm': { name: string | number }
	'chat.group.settings.page.unbanFailed': { error: string | number }
	'chat.group.sticker.prefixLine': { label: string | number }
	'chat.group.unpin.messageLine': { targetId: string | number }
	'chat.group.vote.blockHeading': { prefix: string | number; question: string | number }
	'chat.group.vote.blockHeadingTagged': { question: string | number }
	'chat.group.vote.castLine': { choice: string | number; prefix: string | number }
	'chat.group.vote.castLineTagged': { choice: string | number }
	'chat.group.vote.deadlineLineClosed': { date: string | number }
	'chat.group.vote.deadlineLineOpen': { date: string | number }
	'chat.group.vote.for': { option: string | number }
	'chat.group.vote.optionsPreview': { options: string | number; prefix: string | number }
	'chat.group.vote.optionsPreviewTagged': { options: string | number }
	'chat.group.vote.total': { n: string | number }
	'chat.hub.applyBranchFailed': { error: string | number }
	'chat.hub.attachment.dropToUpload': { channel: string | number }
	'chat.hub.autoBranchFailed': { error: string | number }
	'chat.hub.banners.fork.tipScore': { score: string | number; short: string | number }
	'chat.hub.banners.fork.tips': { count: string | number }
	'chat.hub.banners.gshBuffer': { total: string | number }
	'chat.hub.banners.mailboxPending': { count: string | number }
	'chat.hub.banners.quarantine': { count: string | number }
	'chat.hub.banners.suspectedRemoved': { count: string | number }
	'chat.hub.block.opposingFailed': { error: string | number }
	'chat.hub.block.opposingOk': { count: string | number }
	'chat.hub.call.duration': { duration: string | number }
	'chat.hub.call.joinFailed': { error: string | number }
	'chat.hub.call.participants': { n: string | number }
	'chat.hub.call.peerCount': { n: string | number }
	'chat.hub.call.screenFailed': { error: string | number }
	'chat.hub.call.startedAt': { time: string | number }
	'chat.hub.channel.context.deleteConfirm': { name: string | number }
	'chat.hub.channel.context.exportFailed': { error: string | number }
	'chat.hub.char.chat.composer.placeholder': { name: string | number }
	'chat.hub.char.chat.start': { name: string | number }
	'chat.hub.char.chat.subtitle': { name: string | number }
	'chat.hub.char.chatsTitle': { name: string | number }
	'chat.hub.char.count': { count: string | number }
	'chat.hub.composer.placeholder': { channel: string | number }
	'chat.hub.config.loadFailed': { error: string | number }
	'chat.hub.config.saveFailed': { error: string | number }
	'chat.hub.createChatFailed': { error: string | number }
	'chat.hub.createModal.failed': { error: string | number }
	'chat.hub.deleteSessionConfirm': { name: string | number }
	'chat.hub.discovery.loadFailed': { message: string | number }
	'chat.hub.discovery.sourceCount': { count: string | number }
	'chat.hub.fed.nonceRotated': { nonce: string | number }
	'chat.hub.fed.repairJoinSnapshotFailed': { error: string | number }
	'chat.hub.fed.repairJoinSnapshotOk': { channels: string | number }
	'chat.hub.federation.loadFailed': { error: string | number }
	'chat.hub.federation.rebindFailed': { error: string | number }
	'chat.hub.files.loadFailed': { error: string | number }
	'chat.hub.files.renameFolderPrompt': { name: string | number }
	'chat.hub.folder.renamePrompt': { name: string | number }
	'chat.hub.forkSplit.failed': { error: string | number }
	'chat.hub.friends.count': { count: string | number }
	'chat.hub.friends.restartConfirm': { name: string | number }
	'chat.hub.friends.restartFailed': { error: string | number }
	'chat.hub.group.context.leave.batch': { count: string | number }
	'chat.hub.group.context.leave.batchOk': { count: string | number }
	'chat.hub.group.context.leave.batchPartial': { failed: string | number; total: string | number }
	'chat.hub.group.context.leave.batchPending': { count: string | number }
	'chat.hub.group.context.leave.confirm': { name: string | number }
	'chat.hub.group.context.leave.confirmBatch': { count: string | number }
	'chat.hub.group.context.setAliasPrompt': { name: string | number }
	'chat.hub.group.unnamed': { suffix: string | number }
	'chat.hub.gshDecryptPending': { gen: string | number }
	'chat.hub.inbox.badgeFetchFailed': { error: string | number }
	'chat.hub.inbox.jumpFailed': { error: string | number }
	'chat.hub.inbox.loadFailed': { error: string | number }
	'chat.hub.inbox.markSeenFailed': { error: string | number }
	'chat.hub.inbox.rowLabel.aria-label': { author: string | number; channel: string | number; group: string | number; preview: string | number }
	'chat.hub.inviteCardMembers': { count: string | number }
	'chat.hub.list.jsonInvalid': { message: string | number }
	'chat.hub.load.groupFailed': { error: string | number }
	'chat.hub.load.listFailed': { error: string | number }
	'chat.hub.load.messagesFailed': { error: string | number }
	'chat.hub.member.context.personalBlockConfirm': { name: string | number }
	'chat.hub.member.context.setAliasPrompt': { name: string | number }
	'chat.hub.member.countLabel': { count: string | number }
	'chat.hub.membersDigest.mismatch': { root: string | number }
	'chat.hub.membersDigest.ok': { root: string | number }
	'chat.hub.membersDigest.okPaged': { pages: string | number; root: string | number }
	'chat.hub.membersDigest.pagesTitle.title': { expected: string | number; pages: string | number }
	'chat.hub.mergeDagFailed': { error: string | number }
	'chat.hub.message.action.failed': { error: string | number }
	'chat.hub.newGroupWith': { name: string | number }
	'chat.hub.operationFailed': { error: string | number }
	'chat.hub.pin.previewInvite': { groupName: string | number }
	'chat.hub.pin.previewVote': { question: string | number }
	'chat.hub.profileEdit.linksPreview': { count: string | number }
	'chat.hub.profileEdit.resetFrom.partFailed': { error: string | number }
	'chat.hub.profilePopup.dm.failed': { error: string | number }
	'chat.hub.profilePopup.setAliasPrompt': { name: string | number }
	'chat.hub.reactionRemovePrompt': { candidates: string | number; emoji: string | number }
	'chat.hub.reputationSlashAlert': { target: string | number }
	'chat.hub.save.emojiFailed': { error: string | number }
	'chat.hub.save.stickerFailed': { error: string | number }
	'chat.hub.send.failed': { error: string | number }
	'chat.hub.send.imageFailed': { error: string | number }
	'chat.hub.send.stickerFailed': { error: string | number }
	'chat.hub.session.deleteFailed': { error: string | number }
	'chat.hub.shareGroupFailed': { error: string | number }
	'chat.hub.startChatWith': { name: string | number }
	'chat.hub.stickers.loadFailed': { error: string | number }
	'chat.hub.stream.av.joinFailed': { error: string | number }
	'chat.hub.stream.av.peers': { count: string | number }
	'chat.hub.sync.failed': { error: string | number }
	'chat.hub.sync.incomplete': { missing: string | number; total: string | number }
	'chat.hub.timeToday': { time: string | number }
	'chat.hub.timeYesterday': { time: string | number }
	'chat.hub.translationPrefs.saveFailed': { error: string | number }
	'chat.hub.trustAuthorDialog.confirmCooldown': { seconds: string | number }
	'chat.hub.trustAuthorDialog.subtitle': { author: string | number }
	'chat.hub.typing': { names: string | number }
	'chat.hub.unbindFriend.confirm': { name: string | number }
	'chat.hub.unbindFriend.failed': { error: string | number }
	'chat.hub.unreadBadge.aria-label': { count: string | number }
	'chat.hub.vote.count': { count: string | number; pct: string | number }
	'chat.hub.vote.createFailed': { error: string | number }
	'chat.hub.vote.deadline': { date: string | number }
	'chat.hub.vote.total': { total: string | number }
	'chat.hub.warmCharCacheFailed': { error: string | number }
	'chat.message.view.logprobsMetricsFooter': { speed: string | number; time: string | number; tokens: string | number; ttft: string | number }
	'chat.message.view.logprobsTopLogprobsMeta': { token: string | number }
	'chat.message.view.share.success': { provider: string | number; sponsorLink: string | number }
	'chat.message.view.tool.overridingFilepath': { filepath: string | number }
	'chat.message.view.tool.readingFilepath': { filepath: string | number }
	'chat.message.view.tool.replacingFilepath': { filepath: string | number }
	'chat.message.view.tool.runningLang': { lang: string | number }
	'chat.message.view.tool.searchingContent': { content: string | number }
	'chat.profile.errors.operationFailed': { error: string | number }
	'chat.profile.federation.saveFailed': { error: string | number }
	'chat.profile.groupMembers': { channels: string | number; members: string | number }
	'chat.profile.owner.confirm.cooldown': { seconds: string | number }
	'chat.profile.owner.saveFailed': { error: string | number }
	'chat.sessionSettings.subtitleRoles': { count: string | number }
	'chat.stickers.authorLabel': { author: string | number }
	'chat.stickers.sticker.count': { count: string | number }
	'chat.typingIndicator.isTyping': { names: string | number }
	'chat.voiceRecording.speechRecognitionFailed': { error: string | number }
	'deskpet.toasts.start_failed': { charname: string | number; message: string | number }
	'deskpet.toasts.started': { charname: string | number }
	'deskpet.toasts.stop_failed': { charname: string | number; message: string | number }
	'deskpet.toasts.stopped': { charname: string | number }
	'directoryListing.indexOf': { path: string | number }
	'discord_bots.alerts.botExists': { botname: string | number }
	'easynew.alerts.error': { message: string | number }
	'easynew.alerts.success': { partName: string | number }
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
	'fountConsole.path.git.upstreamGoneFallbackMaster': { branch: string | number }
	'fountConsole.path.install.packageFailed': { package: string | number }
	'fountConsole.path.install.permissionDeniedAsRoot': { path: string | number }
	'fountConsole.path.install.permissionDeniedNotRoot': { path: string | number }
	'fountConsole.path.protocol.registerFailed': { message: string | number }
	'fountConsole.path.remove.moduleRemoved': { module: string | number }
	'fountConsole.path.remove.remove.backgroundRunnerFailed': { message: string | number }
	'fountConsole.path.remove.remove.denoFailed': { message: string | number }
	'fountConsole.path.remove.remove.moduleFailed': { message: string | number; module: string | number }
	'fountConsole.path.remove.remove.protocolHandlerFailed': { message: string | number }
	'fountConsole.path.remove.uninstallFountPwshFailed': { message: string | number }
	'fountConsole.path.shortcut.desktopShortcutCreated': { path: string | number }
	'fountConsole.path.shortcut.shortcutNotSupported': { os: string | number }
	'fountConsole.path.shortcut.startMenuShortcutCreated': { path: string | number }
	'fountConsole.path.steam.failed': { message: string | number }
	'fountConsole.path.terminalKeybindings.editorRemoved': { path: string | number }
	'fountConsole.path.terminalKeybindings.wtPatchFailed': { message: string | number; path: string | number }
	'fountConsole.path.terminalKeybindings.wtRemoved': { path: string | number }
	'fountConsole.path.update.pinningToCommit': { ref: string | number }
	'fountConsole.path.update.pinningToPullRequest': { pr: string | number }
	'fountConsole.path.update.switchingToBranch': { branch: string | number }
	'fountConsole.path.update.switchingToRemote': { branch: string | number; url: string | number }
	'fountConsole.path.update.unknownTarget': { target: string | number }
	'fountConsole.path.version.branch.title': { branch: string | number }
	'fountConsole.path.version.commit': { ref: string | number }
	'fountConsole.path.version.remote': { ref: string | number }
	'fountConsole.path.version.status.title': { status: string | number }
	'fountConsole.route.setLanguagePreference': { preferredLanguages: string | number; username: string | number }
	'fountConsole.server.localUrl': { url: string | number }
	'fountConsole.server.mdns.bonjourFailed': { error: string | number }
	'fountConsole.server.mdns.failed': { error: string | number }
	'fountConsole.server.showUrl.http': { url: string | number }
	'fountConsole.server.showUrl.https': { url: string | number }
	'fountConsole.test.available': { ids: string | number }
	'fountConsole.test.blocked': { deps: string | number; label: string | number }
	'fountConsole.test.continueDefault': { count: string | number; imperfect: string | number; outdated: string | number }
	'fountConsole.test.continueImperfect': { count: string | number }
	'fountConsole.test.denoPanic.alreadyReported': { signature: string | number }
	'fountConsole.test.denoPanic.detected': { label: string | number; signature: string | number }
	'fountConsole.test.denoPanic.duplicate': { upstream: string | number }
	'fountConsole.test.denoPanic.ghUnavailable': { signature: string | number }
	'fountConsole.test.denoPanic.publishFailed': { signature: string | number }
	'fountConsole.test.denoPanic.published': { url: string | number }
	'fountConsole.test.display.eta': { expected: string | number; remaining: string | number }
	'fountConsole.test.display.etaUnknown': { count: string | number; expected: string | number }
	'fountConsole.test.display.explicitSelectedCount': { count: string | number }
	'fountConsole.test.display.failureLog': { label: string | number }
	'fountConsole.test.display.queued': { count: string | number }
	'fountConsole.test.display.reason': { label: string | number; reason: string | number }
	'fountConsole.test.display.remaining': { remaining: string | number }
	'fountConsole.test.display.remainingOnlyUnknown': { count: string | number }
	'fountConsole.test.display.remainingUnknown': { count: string | number; remaining: string | number }
	'fountConsole.test.failed': { label: string | number }
	'fountConsole.test.failedWithCode': { code: string | number; label: string | number }
	'fountConsole.test.failuresCleared': { manifestId: string | number }
	'fountConsole.test.failuresSaved': { count: string | number; path: string | number }
	'fountConsole.test.federationCleanupPost': { output: string | number }
	'fountConsole.test.federationCleanupPre': { output: string | number }
	'fountConsole.test.heapSnapshotSaved': { path: string | number }
	'fountConsole.test.kernel.unknownAction': { action: string | number }
	'fountConsole.test.manifestMatched': { ids: string | number }
	'fountConsole.test.moduleCheck.missedReady': { label: string | number }
	'fountConsole.test.noRealRunPlanned': { blocked: string | number; reused: string | number; skipped: string | number }
	'fountConsole.test.nodeWorker.error': { error: string | number }
	'fountConsole.test.noiseHits': { hits: string | number }
	'fountConsole.test.noisyOnlyRemain': { count: string | number; suites: string | number }
	'fountConsole.test.outdatedSelected': { count: string | number }
	'fountConsole.test.passed': { label: string | number }
	'fountConsole.test.passedWithNoise': { label: string | number }
	'fountConsole.test.planSlotSummary': { blocked: string | number; reuse: string | number; run: string | number; skipped: string | number }
	'fountConsole.test.prunedAbsentState': { subtests: string | number; suites: string | number }
	'fountConsole.test.queue.append': { label: string | number; reason: string | number; remaining: string | number }
	'fountConsole.test.queue.remove': { label: string | number; reason: string | number; remaining: string | number }
	'fountConsole.test.report.artifacts': { path: string | number }
	'fountConsole.test.report.continueReasonsLink': { path: string | number }
	'fountConsole.test.report.durationMs': { ms: string | number }
	'fountConsole.test.report.durationUnit.day': { n: string | number }
	'fountConsole.test.report.durationUnit.hour': { n: string | number }
	'fountConsole.test.report.durationUnit.min': { n: string | number }
	'fountConsole.test.report.durationUnit.minute': { n: string | number }
	'fountConsole.test.report.durationUnit.sec': { n: string | number }
	'fountConsole.test.report.estimatePoint': { eta: string | number }
	'fountConsole.test.report.label.pullDownstream': { requiredBy: string | number }
	'fountConsole.test.report.label.pullUpstream': { requiredBy: string | number }
	'fountConsole.test.report.pending.estimate': { eta: string | number }
	'fountConsole.test.report.pending.itemExpected': { expected: string | number }
	'fountConsole.test.report.progressFormat': { completed: string | number; total: string | number }
	'fountConsole.test.report.suitesFormat': { completed: string | number; passed: string | number }
	'fountConsole.test.reportPath': { path: string | number }
	'fountConsole.test.reportPathFinal': { path: string | number }
	'fountConsole.test.reusedSuite': { manifestId: string | number; name: string | number; status: string | number }
	'fountConsole.test.runningSuite.base': { manifestId: string | number; name: string | number }
	'fountConsole.test.runningSuite.expected': { expected: string | number }
	'fountConsole.test.selectedSuites': { selected: string | number; total: string | number }
	'fountConsole.test.silentPassedMany': { count: string | number }
	'fountConsole.test.skipBecause.fail': { label: string | number; url: string | number }
	'fountConsole.test.skipBecause.pass': { label: string | number; url: string | number }
	'fountConsole.test.skippedTree': { deps: string | number; label: string | number }
	'fountConsole.test.sleepDetected': { elapsed: string | number; gap: string | number; label: string | number; limit: string | number }
	'fountConsole.test.sleepRetry': { attempt: string | number; label: string | number }
	'fountConsole.test.speculativeDiscard': { deps: string | number; label: string | number }
	'fountConsole.test.state.artifacts': { path: string | number }
	'fountConsole.test.statePathFinal': { path: string | number }
	'fountConsole.test.suiteHeader': { name: string | number }
	'fountConsole.test.terminate.duration': { baseline: string | number; elapsed: string | number; label: string | number; limit: string | number }
	'fountConsole.test.terminate.durationDefault': { elapsed: string | number; label: string | number; limit: string | number }
	'fountConsole.test.terminate.idle': { elapsed: string | number; idleSec: string | number; label: string | number; minutes: string | number }
	'fountConsole.test.terminate.marker': { reason: string | number }
	'fountConsole.test.terminate.speculative': { label: string | number }
	'fountConsole.test.terminate.unknown': { label: string | number }
	'fountConsole.test.terminated': { label: string | number; reason: string | number }
	'fountConsole.test.triggerNoMatch': { pattern: string | number; scope: string | number }
	'fountConsole.test.triggerNoMatchSummary': { count: string | number }
	'fountConsole.test.unknown.fileFilter': { names: string | number; suite: string | number }
	'fountConsole.test.unknown.manifestId': { ids: string | number }
	'fountConsole.test.unknown.subtestFilter': { names: string | number; suite: string | number }
	'fountConsole.test.unknown.suite': { name: string | number }
	'fountConsole.test.unknown.suiteSelector': { ids: string | number }
	'fountConsole.test.unsupportedSubtestFilter': { names: string | number; suite: string | number }
	'fountConsole.test.updateEstimates.summary': { filesChanged: string | number; skipped: string | number; suitesUpdated: string | number }
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
	'ide_integration.apiKey.createError': { message: string | number }
	'ide_integration.supportedEditors.error': { message: string | number }
	'import.alerts.importFailed': { error: string | number }
	'import.errors.fileImportFailed': { message: string | number }
	'import.errors.textImportFailed': { message: string | number }
	'installer_wait_screen.eula.continue_in': { seconds: string | number }
	'installer_wait_screen.features.aiSources.description': { atlasCloudLink: string | number; evolinkLink: string | number }
	'installer_wait_screen.footer.error_message': { error: string | number }
	'installer_wait_screen.utm_welcome.message': { source: string | number }
	'log_viewer.logs.openSourceFailed': { message: string | number }
	'login_info.modal.retrieve_error': { error: string | number }
	'login_info.modal.transfer_error': { error: string | number }
	'oauth_handler.callback.failed': { message: string | number }
	'part_config.alerts.loadEditorFailed': { message: string | number }
	'part_config.alerts.saveConfigFailed': { message: string | number }
	'protocolhandler.offline_dialog.message': { hostUrl: string | number }
	'protocolhandler.runPart.commandError': { error: string | number }
	'protocolhandler.runPart.confirm.message': { partpath: string | number }
	'protocolhandler.unknownError': { error: string | number }
	'serviceSource_manager.alerts.addFileFailed': { error: string | number }
	'serviceSource_manager.alerts.deleteFileFailed': { error: string | number }
	'serviceSource_manager.alerts.fetch.branchesFailed': { error: string | number }
	'serviceSource_manager.alerts.fetch.defaultsFailed': { error: string | number }
	'serviceSource_manager.alerts.fetch.fileDataFailed': { error: string | number }
	'serviceSource_manager.alerts.fetch.fileListFailed': { error: string | number }
	'serviceSource_manager.alerts.fetch.generatorListFailed': { error: string | number }
	'serviceSource_manager.alerts.saveFileFailed': { error: string | number }
	'serviceSource_manager.alerts.savedAsNewFile': { name: string | number }
	'serviceSource_manager.alerts.setDefaultFailed': { error: string | number }
	'serviceSource_manager.buttons.setDefault.checkbox.aria-label': { fileName: string | number }
	'serviceSource_manager.common_config_interface.currentModelTitle': { model: string | number; name: string | number }
	'serviceSource_manager.common_config_interface.loadModelsFailed': { message: string | number }
	'serviceSource_manager.common_config_interface.meta.cachePrice': { read: string | number; write: string | number }
	'serviceSource_manager.common_config_interface.meta.context': { context: string | number }
	'serviceSource_manager.common_config_interface.meta.inputPrice': { price: string | number }
	'serviceSource_manager.common_config_interface.meta.knowledge': { knowledge: string | number }
	'serviceSource_manager.common_config_interface.meta.modalities': { input: string | number; output: string | number }
	'serviceSource_manager.common_config_interface.meta.outputLimit': { output: string | number }
	'serviceSource_manager.common_config_interface.meta.outputPrice': { price: string | number }
	'serviceSource_manager.common_config_interface.meta.releaseDate': { date: string | number }
	'serviceSource_manager.common_config_interface.modelsDevLoadFailed': { message: string | number }
	'serviceSource_manager.common_config_interface.oauth.deviceCode': { code: string | number; uri: string | number }
	'serviceSource_manager.common_config_interface.oauth.failed': { message: string | number }
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
	'social.composer.speechRecognitionFailed': { error: string | number }
	'social.composer.voiceFailed': { error: string | number }
	'social.connectNodeFailed': { error: string | number }
	'social.drafts.deleteFailed': { error: string | number }
	'social.drafts.loadFailed': { error: string | number }
	'social.drafts.saveFailed': { error: string | number }
	'social.dwellFailed': { error: string | number }
	'social.explore.loadFailed': { error: string | number }
	'social.feed.loadFailed': { error: string | number }
	'social.feed.repostedBy': { author: string | number }
	'social.feed.trending.postCount.textContent': { n: string | number }
	'social.feed.trending.postCount.title': { n: string | number }
	'social.inbox.aggregated.follow': { author1: string | number; author2: string | number; count: string | number }
	'social.inbox.aggregated.followTwo': { author1: string | number; author2: string | number }
	'social.inbox.aggregated.like': { author1: string | number; author2: string | number; count: string | number }
	'social.inbox.aggregated.likeTwo': { author1: string | number; author2: string | number }
	'social.inbox.aggregated.repost': { author1: string | number; author2: string | number; count: string | number }
	'social.inbox.aggregated.repostTwo': { author1: string | number; author2: string | number }
	'social.live.joinFailed': { error: string | number }
	'social.live.likes': { n: string | number }
	'social.live.loadFailed': { error: string | number }
	'social.live.postEndedStats': { duration: string | number; likes: string | number; viewers: string | number }
	'social.live.viewers': { n: string | number }
	'social.notes.more': { n: string | number }
	'social.notifications.care_post': { author: string | number }
	'social.notifications.follow': { author: string | number }
	'social.notifications.like': { author: string | number }
	'social.notifications.live_started': { author: string | number }
	'social.notifications.loadFailed': { error: string | number }
	'social.notifications.mention': { author: string | number }
	'social.notifications.poll_closed': { author: string | number }
	'social.notifications.post_note': { author: string | number }
	'social.notifications.reply': { author: string | number }
	'social.notifications.repost': { author: string | number }
	'social.poll.deadline': { deadline: string | number }
	'social.post.exportMediaFailed': { error: string | number }
	'social.profile.cabinetsFailed': { error: string | number }
	'social.profile.loadFailed': { error: string | number }
	'social.replies.loadFailed': { error: string | number }
	'social.reply.context': { author: string | number }
	'social.saved.loadFailed': { error: string | number }
	'social.search.loadFailed': { error: string | number }
	'social.search.trustScore': { score: string | number }
	'social.settings.loadFailed': { error: string | number }
	'social.settings.taste.weight': { weight: string | number }
	'social.time.hoursAgo': { n: string | number }
	'social.time.minutesAgo': { n: string | number }
	'social.video.loadFailed': { error: string | number }
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
	'telegram_bots.alerts.confirmDeleteBot': { botname: string | number }
	'telegram_bots.alerts.invalidJsonConfig': { error: string | number }
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
	'userSettings.deleteAccount.confirmUsernamePrompt': { username: string | number }
	'userSettings.editorCommand.presetOptionPathAvailable': { label: string | number }
	'userSettings.editorCommand.presetOptionPathUnavailable': { label: string | number }
	'userSettings.generalError': { message: string | number }
	'userSettings.passkeys.itemDetails': { created: string | number }
	'userSettings.renameUser.moveFailed': { detail: string | number }
	'userSettings.renameUser.success': { newUsername: string | number }
	'userSettings.userDevices.deviceDetails': { ipAddress: string | number; lastSeen: string | number; userAgent: string | number }
	'userSettings.userDevices.deviceInfo': { deviceId: string | number }
	'util.breadcrumb.clickToNavigate': { path: string | number }
	'util.code_block.copy_failed': { error: string | number }
	'util.pow_captcha.errorMessage': { error: string | number }
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
