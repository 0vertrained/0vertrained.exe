#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
for parser in HeartRateMeasurement WhoopLiveProtocol; do
  swiftc "ios/App/App/$parser.swift" "ios/Tests/${parser}Tests.swift" -o "$out/$parser"
  "$out/$parser"
done
