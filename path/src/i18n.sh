#!/usr/bin/env bash
# --- Internationalization ---

get_system_locales() {
	local locales=() entry
	if [ -n "$LANG" ]; then
		entry=$(echo "$LANG" | cut -d. -f1 | sed 's/_/-/')
		[ -n "$entry" ] && locales+=("$entry")
	fi
	if [ -n "$LANGUAGE" ]; then
		IFS=':' read -r -a lang_array <<<"$LANGUAGE"
		for lang in "${lang_array[@]}"; do
			entry=$(echo "$lang" | cut -d. -f1 | sed 's/_/-/')
			[ -n "$entry" ] && locales+=("$entry")
		done
	fi
	if [ -n "$LC_ALL" ]; then
		entry=$(echo "$LC_ALL" | cut -d. -f1 | sed 's/_/-/')
		[ -n "$entry" ] && locales+=("$entry")
	fi
	if command -v locale >/dev/null; then
		entry=$(locale -uU 2>/dev/null | cut -d. -f1 | sed 's/_/-/')
		[ -n "$entry" ] && locales+=("$entry")
	fi
	locales+=("en-UK")
	# shellcheck disable=SC2207
	locales=($(printf "%s\n" "${locales[@]}" | awk '!x[$0]++'))
	echo "${locales[@]}"
}

get_available_locales() {
	local locale_list_file="$FOUNT_DIR/src/public/locales/list.csv"
	if [ -f "$locale_list_file" ]; then
		tail -n +2 "$locale_list_file" | cut -d, -f1
	else
		echo "en-UK"
	fi
}

get_best_locale() {
	local preferred_locales_str="$1"
	local available_locales_str="$2"
	# shellcheck disable=SC2206
	local preferred_locales=($preferred_locales_str)
	# shellcheck disable=SC2206
	local available_locales=($available_locales_str)

	for preferred in "${preferred_locales[@]}"; do
		[ -n "$preferred" ] || continue
		for available in "${available_locales[@]}"; do
			if [ "$preferred" = "$available" ]; then
				echo "$preferred"
				return
			fi
		done
	done

	for preferred in "${preferred_locales[@]}"; do
		[ -n "$preferred" ] || continue
		local prefix
		prefix=$(echo "$preferred" | cut -d- -f1)
		[ -n "$prefix" ] || continue
		for available in "${available_locales[@]}"; do
			if [[ "$available" == "$prefix"* ]]; then
				echo "$available"
				return
			fi
		done
	done

	echo "en-UK"
}

# Callers must NOT export FOUNT_LOCALE_DATA (avoid ARG_MAX on some Linux)
# shellcheck disable=SC2120
load_locale_data() {
	if [ -z "$FOUNT_LOCALE" ]; then
		local system_locales
		system_locales=$(get_system_locales)
		local available_locales
		available_locales=$(get_available_locales)
		FOUNT_LOCALE=$(get_best_locale "$system_locales" "$available_locales")
		export FOUNT_LOCALE
	fi
	local locale_file="$FOUNT_DIR/src/public/locales/$FOUNT_LOCALE.json"
	if [ ! -f "$locale_file" ]; then
		FOUNT_LOCALE="en-UK"
		export FOUNT_LOCALE
		locale_file="$FOUNT_DIR/src/public/locales/en-UK.json"
	fi
	if ! command -v jq &>/dev/null; then
		if command -v install_package &>/dev/null; then
			install_package "jq" "jq" >&2
		fi
	fi
	if command -v jq &>/dev/null; then
		jq -c '.fountConsole.path // {}' "$locale_file"
	else
		echo "{}"
	fi
}

i18n_supports_ansi() { [ "${FOUNT_CONSOLE_ANSI:-0}" = "1" ]; }

i18n_format_param_value() {
	local param_name="$1"
	local param_value="$2"
	if i18n_supports_ansi; then
		case "$param_name" in
		path)   printf '\033[36m%s\033[0m' "$param_value" ; return ;;
		ref)    printf '\033[34m%s\033[0m' "$param_value" ; return ;;
		branch) printf '\033[33m%s\033[0m' "$param_value" ; return ;;
		status) printf '\033[33m%s\033[0m' "$param_value" ; return ;;
		target) printf '\033[34m%s\033[0m' "$param_value" ; return ;;
		esac
	fi
	printf '%s' "$param_value"
}

i18n_format_backtick_inner() {
	local inner="$1"
	if ! i18n_supports_ansi; then
		printf '%s' "$inner"
		return
	fi
	case "$inner" in
	*://*)
		printf '\033[34m%s\033[0m' "$inner" ;;
	origin | origin/* | upstream | upstream/*)
		printf '\033[34m%s\033[0m' "$inner" ;;
	master | main | HEAD | develop)
		printf '\033[33m%s\033[0m' "$inner" ;;
	.*)
		printf '\033[36m%s\033[0m' "$inner" ;;
	git\ * | fount\ * | deno\ * | winget\ * | pwsh\ * | patchelf\ * | osacompile\ * | lsregister\ * | chmod\ *)
		local cmd="${inner%% *}"
		local rest="${inner#"$cmd "}"
		printf '\033[35m%s\033[0m \033[33m%s\033[0m' "$cmd" "$rest" ;;
	git | fount | deno | winget | pwsh | patchelf | osacompile | lsregister | chmod)
		printf '\033[35m%s\033[0m' "$inner" ;;
	*)
		local _upper
		_upper=$(printf '%s' "$inner" | tr '[:lower:]' '[:upper:]')
		if [ "$inner" = "$_upper" ] && [ "${#inner}" -ge 2 ]; then
			printf '\033[36m%s\033[0m' "$inner"
			return
		fi
		case "$inner" in
		*.*)
			if printf '%s' "$inner" | grep -qE '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'; then
				printf '\033[36m%s\033[0m' "$inner"
				return
			fi ;;
		esac
		printf '\033[35m%s\033[0m' "$inner" ;;
	esac
}

apply_i18n_backticks() {
	local rest="$1" before inner
	while [ -n "$rest" ]; do
		case "$rest" in
		*\`*)
			before="${rest%%\`*}"
			rest="${rest#*\`}"
			case "$rest" in
			*\`*)
				inner="${rest%%\`*}"
				rest="${rest#*\`}"
				printf '%s' "$before"
				i18n_format_backtick_inner "$inner"
				;;
			*)
				printf '%s`%s' "$before" "$rest"
				rest=""
				;;
			esac
			;;
		*)
			printf '%s' "$rest"
			rest=""
			;;
		esac
	done
}

get_i18n() {
	local key="$1"
	if [ -z "$FOUNT_LOCALE_DATA" ]; then
		FOUNT_LOCALE_DATA=$(load_locale_data)
	fi
	local translation
	translation=$(printf '%s' "$FOUNT_LOCALE_DATA" | jq -r --arg key "$key" 'getpath($key | split(".")) // $key')

	shift
	while [ $# -gt 0 ]; do
		local param_name="$1"
		local param_value="$2"
		local formatted_value placeholder backtick_placeholder
		formatted_value=$(i18n_format_param_value "$param_name" "$param_value")
		placeholder="\${${param_name}}"
		backtick_placeholder="\`\${${param_name}}\`"
		translation=${translation//"${backtick_placeholder}"/"${formatted_value}"}
		translation=${translation//"${placeholder}"/"${formatted_value}"}
		shift 2
	done
	apply_i18n_backticks "$translation"
	printf '\n'
}

print_i18n() {
	local color=""
	if [ "$1" = "--color" ]; then
		color="$2"; shift 2
	fi
	if ! i18n_supports_ansi || [ -z "$color" ]; then
		get_i18n "$@"
		return
	fi
	local rst col text
	rst=$(printf '\033[0m')
	col=$(printf '\033[%sm' "$color")
	text=$(get_i18n "$@")
	text="${text//"${rst}"/"${rst}${col}"}"
	printf '%s%s%s\n' "$col" "$text" "$rst"
}
print_i18n_red()    { print_i18n --color "0;31" "$@"; }
print_i18n_yellow() { print_i18n --color "0;33" "$@"; }
print_i18n_green()  { print_i18n --color "0;32" "$@"; }
