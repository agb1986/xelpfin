#!/usr/bin/env bash
# Everything that does not need the emulator: type check, lint, unit/UI tests with coverage,
# then the integration suite against the local Jellyfin container (started if needed).
# Set VERIFY_SKIP_JELLYFIN=1 to stop after the unit tests.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }
step typecheck; npm run -s typecheck
if [ -d vega/node_modules ]; then
  step "typecheck vega"; npm run -s typecheck:vega
else
  echo "skipping the vega type check: run npm ci in vega/ first"
fi
step lint; npm run -s lint
step "unit and UI tests"; npx jest --coverage --coverageReporters=text-summary
if [ "${VERIFY_SKIP_JELLYFIN:-}" = 1 ]; then
  echo "skipping Jellyfin integration tests"; exit 0
fi
step "Jellyfin integration tests"
npm run -s jellyfin:up
npm run -s test:integration
step "verify passed"
