#!/bin/bash

# ChaosChain Mintlify Documentation Deployment Script
# This script helps set up and deploy the Mintlify documentation

set -e  # Exit on any error

echo "🚀 ChaosChain Mintlify Documentation Deployment"
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if we're in the right directory
if [ ! -f "docs.json" ]; then
    print_error "docs.json not found. Please run this script from the docs/mintlify/ directory."
    exit 1
fi

print_status "Found docs.json - in correct directory"

# Check Node.js version
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_status "Node.js version: $NODE_VERSION"
    
    # Check if Node.js version is >= 18
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        print_warning "Node.js version $NODE_VERSION detected. Mintlify recommends Node.js 20+."
        print_info "Consider updating: https://nodejs.org/"
    fi
else
    print_error "Node.js not found. Please install Node.js: https://nodejs.org/"
    exit 1
fi

# Check if Mintlify CLI is installed
if command -v mint &> /dev/null; then
    MINT_VERSION=$(mint --version 2>/dev/null || echo "unknown")
    print_status "Mintlify CLI installed: $MINT_VERSION"
else
    print_warning "Mintlify CLI not found. Installing..."
    npm install -g mintlify@latest
    
    if [ $? -eq 0 ]; then
        print_status "Mintlify CLI installed successfully"
    else
        print_error "Failed to install Mintlify CLI"
        exit 1
    fi
fi

# Validate docs.json
print_info "Validating docs.json configuration..."

# Check if docs.json is valid JSON
if jq empty docs.json 2>/dev/null; then
    print_status "docs.json is valid JSON"
else
    print_error "docs.json is not valid JSON"
    exit 1
fi

# Check required fields
REQUIRED_FIELDS=("name" "navigation" "theme")
for field in "${REQUIRED_FIELDS[@]}"; do
    if jq -e ".$field" docs.json > /dev/null 2>&1; then
        print_status "Required field '$field' found"
    else
        print_error "Required field '$field' missing from docs.json"
        exit 1
    fi
done

# Check for common issues
if jq -e '.colors.anchors' docs.json > /dev/null 2>&1; then
    print_warning "Found 'colors.anchors' which may cause issues. Consider removing."
fi

# Count documentation pages
PAGE_COUNT=$(find . -name "*.mdx" | wc -l | tr -d ' ')
print_status "Found $PAGE_COUNT documentation pages"

# List all MDX files for verification
print_info "Documentation pages:"
find . -name "*.mdx" | sort | while read file; do
    echo "  📄 $file"
done

# Check for missing pages referenced in navigation
print_info "Checking navigation references..."

# Extract page references from navigation (simplified check)
REFERENCED_PAGES=$(jq -r '.navigation.pages[]?, .navigation.groups[]?.pages[]?' docs.json 2>/dev/null | grep -v null || true)

if [ ! -z "$REFERENCED_PAGES" ]; then
    echo "$REFERENCED_PAGES" | while read page; do
        if [ ! -z "$page" ] && [ "$page" != "null" ]; then
            PAGE_FILE="${page}.mdx"
            if [ -f "$PAGE_FILE" ]; then
                echo "  ✅ $PAGE_FILE"
            else
                print_warning "Referenced page not found: $PAGE_FILE"
            fi
        fi
    done
fi

# Offer deployment options
echo ""
echo "🎯 Deployment Options:"
echo "======================"
echo ""
echo "1. 🔧 Development Server (Local Testing)"
echo "   Command: mint dev"
echo "   URL: http://localhost:3000"
echo ""
echo "2. 📦 Production Build (Verify Before Deploy)"
echo "   Command: mint build"
echo "   Output: Validates all pages and configuration"
echo ""
echo "3. 🌐 Deploy to Mintlify (Production)"
echo "   Steps:"
echo "   - Push this directory to your GitHub repository"
echo "   - Connect repository in Mintlify dashboard"
echo "   - Configure build settings to use this directory"
echo ""

# Ask user what they want to do
echo "What would you like to do?"
echo "1) Start development server"
echo "2) Build for production"
echo "3) Show deployment instructions"
echo "4) Exit"
echo ""
read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        print_info "Starting development server..."
        print_info "Press Ctrl+C to stop the server"
        mint dev
        ;;
    2)
        print_info "Building for production..."
        mint build
        if [ $? -eq 0 ]; then
            print_status "Build successful! Ready for deployment."
        else
            print_error "Build failed. Please check the errors above."
        fi
        ;;
    3)
        echo ""
        print_info "Deployment Instructions:"
        echo "========================"
        echo ""
        echo "1. 📁 Copy Documentation"
        echo "   - Copy this entire 'docs/mintlify/' directory to your new repository"
        echo "   - Ensure all .mdx files and docs.json are included"
        echo ""
        echo "2. 🔗 Connect to Mintlify"
        echo "   - Go to https://dashboard.mintlify.com/"
        echo "   - Connect your GitHub repository"
        echo "   - Set the documentation directory to 'docs/mintlify/'"
        echo ""
        echo "3. ⚙️  Configure Build"
        echo "   - Mintlify will automatically detect docs.json"
        echo "   - Verify the build settings in the dashboard"
        echo "   - Deploy and test your documentation"
        echo ""
        echo "4. 🎉 Go Live"
        echo "   - Your documentation will be available at your custom domain"
        echo "   - Update any links in your main repository"
        echo ""
        ;;
    4)
        print_info "Goodbye! Your documentation is ready for deployment."
        ;;
    *)
        print_warning "Invalid choice. Exiting."
        ;;
esac

echo ""
print_status "ChaosChain documentation deployment script completed!"
print_info "For support, visit: https://mintlify.com/docs"
