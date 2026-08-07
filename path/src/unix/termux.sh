#!/usr/bin/env bash
# Termux-specific helpers (locale + sensor API)

# Resolve getprop even when /system/bin is absent from PATH (some Termux setups).
android_getprop() {
	local key="$1" path
	path=$(command -v getprop 2>/dev/null) || path=
	if [ -n "$path" ]; then
		"$path" "$key" 2>/dev/null
		return 0
	fi
	for path in /system/bin/getprop /system/xbin/getprop; do
		if [ -x "$path" ]; then
			"$path" "$key" 2>/dev/null
			return 0
		fi
	done
	return 1
}

# Android system locale tag (BCP 47), first of a comma-separated list. Echoes nothing on failure.
android_system_locale_tag() {
	local localeTag localeLanguage region variant
	localeTag=$(android_getprop persist.sys.locale || true)
	if [ -z "$localeTag" ]; then
		localeLanguage=$(android_getprop persist.sys.language || true)
		if [ -n "$localeLanguage" ]; then
			region=$(android_getprop persist.sys.country || true)
			variant=$(android_getprop persist.sys.localevar || true)
			localeTag="$localeLanguage"
			[ -n "$region" ] && localeTag="$localeTag-$region"
			[ -n "$variant" ] && localeTag="$localeTag-$variant"
		fi
	fi
	if [ -z "$localeTag" ]; then
		localeTag=$(android_getprop ro.product.locale || true)
	fi
	if [ -z "$localeTag" ]; then
		localeLanguage=$(android_getprop ro.product.locale.language || true)
		region=$(android_getprop ro.product.locale.region || true)
		if [ -n "$localeLanguage" ]; then
			localeTag="$localeLanguage"
			[ -n "$region" ] && localeTag="$localeTag-$region"
		fi
	fi
	if [ -z "$localeTag" ] && command -v settings >/dev/null 2>&1; then
		localeTag=$(settings get system system_locales 2>/dev/null || true)
		[ "$localeTag" = "null" ] && localeTag=
	fi
	localeTag="${localeTag%%,*}"
	localeTag=$(printf '%s' "$localeTag" | tr -d '[:space:]')
	[ -n "$localeTag" ] || return 1
	printf '%s\n' "$localeTag"
}

# BCP 47 → POSIX LANG (zh-Hans-CN → zh_CN.UTF-8; en → en.UTF-8).
android_locale_to_lang() {
	local localeTag="${1//_/-}" language="" region="" part
	local IFS='-'
	# shellcheck disable=SC2086 # intentional IFS split on -
	set -- $localeTag
	language="${1:-}"
	[ -n "$language" ] || return 1
	shift
	for part in "$@"; do
		case "$part" in
		[A-Za-z]) break ;; # singleton extension (u/t/x/…) — stop
		[A-Za-z][A-Za-z][A-Za-z][A-Za-z]) ;; # script (Hans/Hant/Latn) — skip
		[A-Za-z][A-Za-z] | [0-9][0-9][0-9])
			[ -z "$region" ] && region="$part"
			;;
		esac
	done
	if [ -n "$region" ]; then
		printf '%s_%s.UTF-8\n' "$language" "$region"
	else
		printf '%s.UTF-8\n' "$language"
	fi
}

# Termux default LANG is weak; apply Android system locale for CLI i18n / gettext.
termux_apply_android_lang() {
	local localeTag localeLanguage
	[[ ${IN_TERMUX:-0} -eq 1 ]] || return 0
	# Drop LC_ALL so LANG wins for gettext; do this before probe so early returns leave LANG usable.
	unset LC_ALL
	localeTag=$(android_system_locale_tag || true)
	[ -n "$localeTag" ] || return 0
	localeLanguage=$(android_locale_to_lang "$localeTag") || return 0
	[ -n "$localeLanguage" ] || return 0
	LANG="$localeLanguage"
	export LANG
}

# Ensure termux-sensor CLI (pkg termux-api); tracked for uninstall. Soft-fail if missing.
termux_ensure_sensor_api() {
	[[ $IN_TERMUX -eq 1 ]] || return 0
	command -v termux-sensor &>/dev/null && return 0
	require packages
	install_package "termux-sensor" "termux-api" || true
}
