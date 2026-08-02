#!/usr/bin/env bash
# Cross-platform in-place sed (macOS requires an empty backup suffix argument)
run_sed_inplace() {
	local expression="$1"
	local file="$2"
	if [ "$OS_TYPE" = "Darwin" ]; then
		sed -i '' "$expression" "$file"
	else
		sed -i "$expression" "$file"
	fi
}

fount_sed_escape() {
	echo "$1" | sed 's/\//\\\//g'
}

