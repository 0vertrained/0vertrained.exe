#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
for parser in HeartRateMeasurement WhoopLiveProtocol; do
  swiftc "ios/App/App/$parser.swift" "ios/Tests/${parser}Tests.swift" -o "$out/$parser"
  "$out/$parser"
done
set -- ios/App/App/WhoopLiveProtocol.swift ios/App/App/WhoopHistory.swift
if [ "$(uname -s)" = Darwin ]; then
  set -- "$@" ios/App/App/WhoopHistoryStore.swift
fi
swiftc "$@" ios/Tests/WhoopHistoryTests.swift -o "$out/WhoopHistory"
"$out/WhoopHistory"
