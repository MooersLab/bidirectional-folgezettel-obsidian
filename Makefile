# Makefile for Bidirectional Folgezettel Obsidian Plugin

.PHONY: all build test test-coverage test-first-child lint clean dev install

# Default target: run lint, tests, and build
all: lint test build

# Install dependencies
install:
	npm install

# Development mode with file watching
dev:
	npm run dev

# Production build with type checking
build:
	npm run build

# Run tests
test:
	npx jest

# Run tests with coverage report
test-coverage:
	npx jest --coverage

# Run only the first-child creation tests
test-first-child:
	npx jest -t "firstChildAddress|createFirstChild"

# Run linter
lint:
	npx tsc --noEmit --skipLibCheck

# Clean build artifacts
clean:
	rm -f main.js
	rm -rf coverage
	rm -rf node_modules/.cache
