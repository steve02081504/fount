#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() {
	package_name="$1"
	install_successful=0
	if command -v "$package_name" >/dev/null 2>&1; then return 0; fi
	if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi
	if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi
	if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then
		sudo apt-get update
		sudo apt-get install -y "$package_name" && install_successful=1
	else
		apt-get update
		apt-get install -y "$package_name" && install_successful=1
	fi; fi
	if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi
	if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then
		sudo pacman -Syy
		sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1
	else
		pacman -Syy
		pacman -S --needed --noconfirm "$package_name" && install_successful=1
	fi; fi
	if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi
	if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi
	if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi
	if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi
	if [ "$install_successful" -eq 1 ]; then
		if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi
		return 0
	else
		echo "Error: $package_name installation failed." >&2
		return 1
	fi
}
install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"

if [ "$#" -eq 0 ]; then
	/bin/bash "$SCRIPT_DIR/path/fount.sh" open keepalive
else
	/bin/bash "$SCRIPT_DIR/path/fount.sh" "$@"
fi
RETURN_CODE=$?

if [ "$RETURN_CODE" -ne 0 ] && [ "$RETURN_CODE" -ne 255 ]; then
	printf "Press Enter to continue..."
	read _
fi

exit "$RETURN_CODE"
