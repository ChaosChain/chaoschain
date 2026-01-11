#!/bin/bash
#
# ChaosChain Protocol Deployment to Ethereum Sepolia
# Uses Official ERC-8004 Jan 2026 Contracts
#
# Prerequisites:
# 1. Set DEPLOYER_PRIVATE_KEY in .env
# 2. Fund deployer with Sepolia ETH (at least 0.5 ETH)
# 3. Set ETHERSCAN_API_KEY for verification (optional)
#

set -e

echo "======================================================"
echo "ChaosChain Protocol Deployment - Ethereum Sepolia"
echo "======================================================"
echo ""

# Load .env if exists
if [ -f .env ]; then
    source .env
fi

# Check for private key
if [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
    echo "ERROR: DEPLOYER_PRIVATE_KEY not set!"
    echo "Add it to .env or export it:"
    echo "  export DEPLOYER_PRIVATE_KEY=your_key_here"
    exit 1
fi

# Official ERC-8004 Jan 2026 Contracts on ETH Sepolia
export IDENTITY_REGISTRY="0x8004A818BFB912233c491871b3d84c89A494BD9e"
export REPUTATION_REGISTRY="0x8004B663056A597Dffe9eCcC1965A193B7388713"
export VALIDATION_REGISTRY="0x0000000000000000000000000000000000000000"

echo "ERC-8004 Registry Addresses (Official Jan 2026):"
echo "  Identity:   $IDENTITY_REGISTRY"
echo "  Reputation: $REPUTATION_REGISTRY"
echo "  Validation: $VALIDATION_REGISTRY (not yet deployed)"
echo ""

# Set RPC if not already set
if [ -z "$SEPOLIA_RPC" ]; then
    export SEPOLIA_RPC="https://ethereum-sepolia-rpc.publicnode.com"
fi

echo "RPC: $SEPOLIA_RPC"
echo ""

# Build first
echo "Building contracts..."
forge build

# Run deployment
echo ""
echo "Deploying to Ethereum Sepolia..."
echo ""

# Check if --verify flag should be used
VERIFY_FLAG=""
if [ -n "$ETHERSCAN_API_KEY" ]; then
    VERIFY_FLAG="--verify"
    echo "Contract verification enabled"
else
    echo "No ETHERSCAN_API_KEY - skipping verification"
fi

forge script script/DeployCore.s.sol \
    --rpc-url "$SEPOLIA_RPC" \
    --broadcast \
    $VERIFY_FLAG \
    -vvv

echo ""
echo "======================================================"
echo "Deployment Complete!"
echo "======================================================"
echo ""
echo "IMPORTANT: Update SDK with new contract addresses!"
echo "Edit: packages/sdk/chaoschain_sdk/chaos_agent.py"
echo ""

