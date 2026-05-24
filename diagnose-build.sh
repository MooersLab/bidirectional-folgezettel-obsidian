#!/bin/bash
# Diagnostic script for Bidirectional Folgezettel plugin build issues

echo "=========================================="
echo "Build Diagnostic for Bidirectional Folgezettel"
echo "=========================================="
echo ""

# Check current directory
echo "1. Current directory:"
pwd
echo ""

# Check if tsconfig.json exists
echo "2. Checking for tsconfig.json:"
if [ -f "tsconfig.json" ]; then
    echo "   ✓ tsconfig.json found"
    echo "   Content preview:"
    head -20 tsconfig.json | sed 's/^/   /'
else
    echo "   ✗ tsconfig.json NOT FOUND"
fi
echo ""

# Check for main.ts location
echo "3. Searching for main.ts:"
find . -name "main.ts" -type f 2>/dev/null | head -5
echo ""

# Check package.json build script
echo "4. Checking package.json build script:"
if [ -f "package.json" ]; then
    grep -A 3 '"build"' package.json | sed 's/^/   /'
else
    echo "   ✗ package.json NOT FOUND"
fi
echo ""

# Check if src directory exists
echo "5. Directory structure:"
ls -la | head -15
echo ""

if [ -d "src" ]; then
    echo "   src/ directory contents:"
    ls -la src/ | sed 's/^/   /'
fi
echo ""

echo "=========================================="
echo "Recommended Actions:"
echo "=========================================="
echo ""
echo "If tsconfig.json is missing, create one with the content below."
echo "If main.ts is not in the expected location, move it to src/main.ts"
echo ""
