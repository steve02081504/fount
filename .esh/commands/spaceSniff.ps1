SpaceSniffer scan $(Resolve-Path "$PSScriptRoot/../../") filter "|\node_modules;|\.git;|\*_dist;|\dist"
SpaceSniffer scan $(Resolve-Path "$PSScriptRoot/../../node_modules")
