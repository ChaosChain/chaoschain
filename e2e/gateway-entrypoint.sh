#!/bin/sh
set -e

echo "==> Waiting for addresses.json..."
while [ ! -f /e2e/addresses.json ]; do sleep 1; done

echo "==> Reading contract addresses..."
export CHAOS_CORE_ADDRESS=$(node -e "console.log(require('/e2e/addresses.json').CHAOS_CORE)")
export REWARDS_DISTRIBUTOR_ADDRESS=$(node -e "console.log(require('/e2e/addresses.json').REWARDS_DISTRIBUTOR)")

export ADMIN_SIGNER_ADDRESS=$(node -e "console.log(require('/e2e/addresses.json').DEPLOYER)")

echo "  CHAOS_CORE_ADDRESS=$CHAOS_CORE_ADDRESS"
echo "  REWARDS_DISTRIBUTOR_ADDRESS=$REWARDS_DISTRIBUTOR_ADDRESS"
echo "  ADMIN_SIGNER_ADDRESS=$ADMIN_SIGNER_ADDRESS"

echo "==> Running database migration..."
PGPASSWORD=gateway psql -h postgres -U gateway -d gateway -f /app/migrations/001_initial.sql

echo "==> Starting gateway..."
exec node dist/app.js
