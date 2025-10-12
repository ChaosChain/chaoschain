#!/bin/bash
# ChaosChain SDK v0.2.0 - TestPyPI Deployment Commands
# Run these commands to deploy to TestPyPI

set -e

echo "=================================================="
echo "ChaosChain SDK v0.2.0 - TestPyPI Deployment"
echo "=================================================="

# Step 1: Clean old builds
echo ""
echo "Step 1: Cleaning old builds..."
rm -rf dist/ build/ *.egg-info chaoschain_sdk.egg-info
echo "✅ Clean complete"

# Step 2: Build the package
echo ""
echo "Step 2: Building package..."
python3 -m build
echo "✅ Build complete"

# Step 3: List build artifacts
echo ""
echo "Step 3: Build artifacts:"
ls -lh dist/
echo ""

# Step 4: Upload to TestPyPI
echo "Step 4: Ready to upload to TestPyPI"
echo ""
echo "Run this command:"
echo "  python3 -m twine upload --repository testpypi dist/*"
echo ""
echo "You'll need your TestPyPI API token."
echo ""
echo "=================================================="
echo "After upload, test install with:"
echo "  pip install --index-url https://test.pypi.org/simple/ \\"
echo "    --extra-index-url https://pypi.org/simple/ \\"
echo "    chaoschain-sdk==0.2.0"
echo "=================================================="

