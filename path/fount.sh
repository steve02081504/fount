#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

if ! command -v fount &> /dev/null; then
	if ! grep -q "export PATH=\"\$PATH:$FOUNT_DIR/path\"" "$HOME/.bashrc"; then
		echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.bashrc"
	fi
	export PATH="$PATH:$FOUNT_DIR/path"
fi

if ! command -v git &> /dev/null; then
	if command -v apt-get &> /dev/null; then
		sudo apt-get update
		sudo apt-get install -y git
	elif command -v brew &> /dev/null; then
		brew install git
	elif command -v pacman &> /dev/null; then
		sudo pacman -Syy
		sudo pacman -S --needed git
	elif command -v dnf &> /dev/null; then
		sudo dnf install -y git
	elif command -v zypper &> /dev/null; then
		sudo zypper install -y git
	else
		echo "git could not be found"
		exit 1
	fi
fi
if [ ! -d "$FOUNT_DIR/.git" ]; then
	rm -rf "$FOUNT_DIR/.git-clone"
	mkdir -p "$FOUNT_DIR/.git-clone"
	git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
	mv "$FOUNT_DIR/.git-clone/.git" "$FOUNT_DIR/.git"
	rm -rf "$FOUNT_DIR/.git-clone"
	git -C "$FOUNT_DIR" fetch origin
	git -C "$FOUNT_DIR" reset --hard origin/master
	git -C "$FOUNT_DIR" checkout origin/master
fi
git -C "$FOUNT_DIR" pull

if ! command -v deno &> /dev/null; then
	curl -fsSL https://deno.land/install.sh | sh
fi

if [ ! -d "$FOUNT_DIR/node_modules" ]; then
	deno install --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
fi

deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" $@
