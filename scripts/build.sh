#!/bin/bash

set -e

echo "🏗️ Building Polymarket Telegram Bot..."

# Clean previous build
if [ -d "dist" ]; then
  echo "🧹 Cleaning previous build..."
  rm -rf dist
fi

# Run TypeScript compilation
echo "🔧 Compiling TypeScript..."
npm run build

# Verify build
if [ ! -d "dist" ]; then
  echo "❌ Build failed - dist directory not created"
  exit 1
fi

echo "✅ Build completed successfully!"
echo "📁 Build artifacts:"
ls -la dist/

# Run tests
echo "🧪 Running tests..."
npm test

echo "🚀 Build and tests complete!"