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
	local tag lang country variant
	tag=$(android_getprop persist.sys.locale || true)
	if [ -z "$tag" ]; then
		lang=$(android_getprop persist.sys.language || true)
		if [ -n "$lang" ]; then
			country=$(android_getprop persist.sys.country || true)
			variant=$(android_getprop persist.sys.localevar || true)
			tag="$lang"
			[ -n "$country" ] && tag="$tag-$country"
			[ -n "$variant" ] && tag="$tag-$variant"
		fi
	fi
	if [ -z "$tag" ]; then
		tag=$(android_getprop ro.product.locale || true)
	fi
	if [ -z "$tag" ]; then
		lang=$(android_getprop ro.product.locale.language || true)
		country=$(android_getprop ro.product.locale.region || true)
		if [ -n "$lang" ]; then
			tag="$lang"
			[ -n "$country" ] && tag="$tag-$country"
		fi
	fi
	if [ -z "$tag" ] && command -v settings >/dev/null 2>&1; then
		tag=$(settings get system system_locales 2>/dev/null || true)
		[ "$tag" = "null" ] && tag=
	fi
	tag="${tag%%,*}"
	tag=$(printf '%s' "$tag" | tr -d '[:space:]')
	[ -n "$tag" ] || return 1
	printf '%s\n' "$tag"
}

# BCP 47 → POSIX LANG (zh-Hans-CN → zh_CN.UTF-8; en → en.UTF-8).
android_locale_to_lang() {
	local tag="${1//_/-}" language="" region="" part
	local IFS='-'
	# shellcheck disable=SC2086 # intentional IFS split on -
	set -- $tag
	language="${1:-}"
	[ -n "$language" ] || return 1
	shift || true
	for part in "$@"; do
		case "$part" in
		[A-Za-z][A-Za-z][A-Za-z][A-Za-z]) ;; # script (Hans/Hant/Latn) — skip
		[A-Za-z][A-Za-z] | [0-9][0-9][0-9]) region="$part" ;;
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
	local tag lang
	[[ ${IN_TERMUX:-0} -eq 1 ]] || return 0
	tag=$(android_system_locale_tag || true)
	[ -n "$tag" ] || return 0
	lang=$(android_locale_to_lang "$tag") || return 0
	[ -n "$lang" ] || return 0
	LANG="$lang"
	export LANG
	# Drop LC_ALL so LANG wins for gettext; fount i18n reads LANG first either way.
	unset LC_ALL
}

# Ensure termux-sensor CLI (pkg termux-api); tracked for uninstall. Soft-fail if missing.
termux_ensure_sensor_api() {
	[[ $IN_TERMUX -eq 1 ]] || return 0
	command -v termux-sensor &>/dev/null && return 0
	require packages
	install_package "termux-sensor" "termux-api" || true
}
