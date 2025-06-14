#!/bin/bash

set -e

echo "🔧 Building Minimal AGS MCP Server Docker Image..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: Run this script from the ags-mcp-server directory"
    exit 1
fi

# Build the TypeScript project
echo "📦 Building TypeScript..."
npm run build

# Create build context with minimal AGS source
echo "📋 Preparing minimal build context..."
BUILD_CONTEXT=$(mktemp -d)
echo "   Using build context: $BUILD_CONTEXT"

# Copy app files
cp -r . "$BUILD_CONTEXT/app/"

# Copy only the minimal AGS source needed for tools
mkdir -p "$BUILD_CONTEXT/ags"
cp -r ../Common "$BUILD_CONTEXT/ags/"
cp -r ../Tools "$BUILD_CONTEXT/ags/"

# Create a minimal CMakeLists.txt just for tools
cat > "$BUILD_CONTEXT/ags/CMakeLists.txt" << 'EOF'
cmake_minimum_required(VERSION 3.13)
project(AGS_Tools)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add minimal common library
add_library(common_minimal
    Common/util/string.cpp
    Common/util/string_compat.c
    Common/util/stream.cpp
    Common/util/filestream.cpp
    Common/util/file.cpp
    Common/util/path.cpp
    Common/util/data_ext.cpp
    Common/util/memorystream.cpp
    Common/game/room_file_base.cpp
    Common/debug/debugmanager.cpp
    Common/core/asset.cpp
)

target_include_directories(common_minimal PUBLIC Common)

# Add crmpak tool
add_executable(crmpak Tools/crmpak/main.cpp)
target_link_libraries(crmpak common_minimal)
target_include_directories(crmpak PRIVATE Tools)

# Add crm2ash tool
add_executable(crm2ash Tools/crm2ash/main.cpp)
target_link_libraries(crm2ash common_minimal)
target_include_directories(crm2ash PRIVATE Tools)
EOF

# Create Dockerfile
cat > "$BUILD_CONTEXT/Dockerfile" << 'EOF'
# Minimal AGS MCP Server build
FROM ubuntu:22.04 as builder

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY ags/ ./ags/

# Build tools with minimal dependencies
RUN cd ags && \
    mkdir build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    make crmpak crm2ash -j$(nproc)

# Runtime stage
FROM node:18-slim

# Copy tools from builder
COPY --from=builder /build/ags/build/crmpak /usr/local/bin/crmpak
COPY --from=builder /build/ags/build/crm2ash /usr/local/bin/crm2ash
RUN chmod +x /usr/local/bin/crmpak /usr/local/bin/crm2ash

# Set up application
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --only=production

COPY app/dist/ ./dist/
RUN mkdir -p /app/rooms /app/games

# Security
RUN groupadd -r ags && useradd -r -g ags ags && chown -R ags:ags /app
USER ags

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD crmpak --help > /dev/null || exit 1

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
EOF

# Build the image
echo "🐳 Building minimal Docker image..."
cd "$BUILD_CONTEXT"
docker build -t ags-mcp-server:minimal .

# Clean up
echo "🧹 Cleaning up..."
rm -rf "$BUILD_CONTEXT"

echo "✅ Minimal build complete!"
echo "🔍 Test: docker run --rm ags-mcp-server:minimal crmpak --help"
echo "🚀 Run: docker run -p 3000:3000 ags-mcp-server:minimal"