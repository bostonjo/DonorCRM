#!/bin/bash
# Automated deployment script with OAuth verification
# This script creates a new Apps Script deployment which automatically triggers OAuth consent

set -e  # Exit on error

echo "================================================"
echo "Apps Script Deployment with OAuth Verification"
echo "================================================"
echo ""

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Get current version from Code.gs
echo "📋 Reading version from Code.gs..."
VERSION=$(grep "const APP_VERSION" Code.gs | cut -d"'" -f2)

if [ -z "$VERSION" ]; then
    echo "❌ Error: Could not find APP_VERSION in Code.gs"
    exit 1
fi

echo "✓ Current version: $VERSION"
echo ""

# Ask for deployment description
echo "📝 Creating deployment for version $VERSION"
read -p "Enter deployment description (or press Enter for default): " DESCRIPTION

if [ -z "$DESCRIPTION" ]; then
    DESCRIPTION="v$VERSION: Automated deployment"
fi

echo ""
echo "🚀 Creating new deployment..."
echo "   Version: $VERSION"
echo "   Description: $DESCRIPTION"
echo ""

# Create new deployment (this triggers OAuth consent)
if clasp deploy -d "$DESCRIPTION"; then
    echo ""
    echo "✅ Deployment created successfully!"
    echo ""
    echo "📋 All deployments:"
    echo "-------------------"
    clasp deployments
    echo ""
    echo "⚠️  IMPORTANT NEXT STEPS:"
    echo "1. Find the NEW deployment URL in the list above"
    echo "2. Open that URL in your browser"
    echo "3. You will be prompted to authorize OAuth scopes"
    echo "4. After authorizing, test the new deployment thoroughly"
    echo "5. Once verified working, update production to use the new URL"
    echo ""
else
    echo ""
    echo "❌ Deployment failed!"
    echo "Please check the error message above."
    exit 1
fi
