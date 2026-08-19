# the-fount

An npm install bootstrap for [fount](https://github.com/steve02081504/fount), a programmable, standardised, modular, customisable agent framework.

## What it does

`the-fount` does not contain fount itself — it installs fount on your machine:

1. If a `fount` command already exists on your PATH, it forwards the rest of the arguments to it (equivalent to `fount <args>`).
2. Otherwise it installs fount via the official installer (`install.ps1` / `install.sh`), then forwards the arguments.

Works with node / bun / deno.

## Usage

```sh
npx the-fount
```

## Uninstall

Since npm cannot run commands when a package is uninstalled, uninstall fount with:

```sh
fount remove
# or
npx the-fount remove
```
