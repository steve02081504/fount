#!/usr/bin/env bash
# Cross-platform in-place sed (macOS requires an empty backup suffix argument)
run_sed_inplace() {
	if [ "$OS_TYPE" = "Darwin" ]; then
		sed -i '' "$1" "$2"
	else
		sed -i "$1" "$2"
	fi
}

sed_escape() {
	printf '%s' "${1//\//\\/}"
}
