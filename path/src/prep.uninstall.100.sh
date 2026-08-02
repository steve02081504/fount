#!/usr/bin/env bash
set_title "𝓯𝓸𝓾𝓷𝓽"
write_taskbar_progress 0
run shutdown
write_taskbar_progress 5
run_deno clean
write_taskbar_progress 15
get_i18n 'remove.removing.fount.main'
