#!/bin/bash

set -e

echo "🔧 Building AGS MCP Server..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: Run this script from the ags-mcp-server directory"
    exit 1
fi

# Build the TypeScript project
echo "📦 Building TypeScript..."
npm run build

# Copy the pre-built crmpak binary from the parent AGS build
echo "📋 Copying AGS tools..."

# Look for crmpak in various possible locations
CRMPAK_LOCATIONS=(
    "../build/Tools/crmpak"
    "../Tools/crmpak"
    "../../Tools/crmpak"
)

CRMPAK_FOUND=""
for location in "${CRMPAK_LOCATIONS[@]}"; do
    if [[ -f "$location" ]]; then
        CRMPAK_FOUND="$location"
        break
    fi
done

if [[ -n "$CRMPAK_FOUND" ]]; then
    cp "$CRMPAK_FOUND" "./crmpak"
    chmod +x "./crmpak"
    echo "   ✅ Copied crmpak binary from $CRMPAK_FOUND"
else
    echo "   ⚠️  crmpak not found. Building AGS tools first..."
    
    # Build AGS tools if not available
    cd ..
    if [[ ! -f "CMakeCache.txt" ]]; then
        echo "   🔨 Configuring AGS build..."
        cmake . -DAGS_BUILD_TOOLS=ON -DCMAKE_BUILD_TYPE=Release
    fi
    
    echo "   🔨 Building crmpak..."
    cmake --build . --target crmpak -- -j 4
    
    cd ags-mcp-server
    # Try to find the newly built binary
    for location in "${CRMPAK_LOCATIONS[@]}"; do
        if [[ -f "$location" ]]; then
            cp "$location" "./crmpak"
            chmod +x "./crmpak"
            echo "   ✅ Built and copied crmpak binary from $location"
            break
        fi
    done
    
    if [[ ! -f "./crmpak" ]]; then
        echo "   ❌ Error: Could not find crmpak binary after build"
        exit 1
    fi
fi

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t ags-mcp-server:latest .

# Clean up temporary files
echo "🧹 Cleaning up..."
rm -f "./crmpak"

echo "✅ Build complete!"
echo "🚀 To run: docker-compose up"
echo "📊 To test: npm run demo"
echo "🔍 To verify: docker run --rm ags-mcp-server:latest crmpak --help"