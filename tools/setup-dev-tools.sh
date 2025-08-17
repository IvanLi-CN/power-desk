#!/bin/bash

# Power Desk Development Tools Setup Script
# This script installs and configures development tools for code quality

set -e

echo "🔧 Setting up Power Desk development tools..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Rust toolchain components
setup_rust() {
    print_status "Setting up Rust toolchain..."
    
    if ! command_exists rustc; then
        print_error "Rust is not installed. Please install Rust first: https://rustup.rs/"
        exit 1
    fi
    
    # Install required components
    print_status "Installing Rust components..."
    rustup component add rust-src rustfmt clippy
    
    # Add target
    print_status "Adding RISC-V target..."
    rustup target add riscv32imc-unknown-none-elf
    
    print_success "Rust toolchain setup complete"
}

# Install lefthook
setup_lefthook() {
    print_status "Setting up lefthook (Git hooks manager)..."
    
    if command_exists lefthook; then
        print_status "lefthook is already installed"
    else
        print_status "Installing lefthook..."
        
        # Try different installation methods
        if command_exists go; then
            go install github.com/evilmartians/lefthook@latest
        elif command_exists brew; then
            brew install lefthook
        elif command_exists curl; then
            # Install via script
            curl -1sLf 'https://dl.cloudsmith.io/public/evilmartians/lefthook/setup.deb.sh' | sudo -E bash
            sudo apt install lefthook
        else
            print_warning "Could not install lefthook automatically. Please install manually:"
            print_warning "https://github.com/evilmartians/lefthook#installation"
            return 1
        fi
    fi
    
    # Install hooks
    print_status "Installing Git hooks..."
    lefthook install
    
    print_success "lefthook setup complete"
}

# Setup Node.js tools for commitlint
setup_nodejs_tools() {
    print_status "Setting up Node.js tools for commit linting..."
    
    # Check if we have a Node.js package manager
    if command_exists bun; then
        print_status "Using bun for Node.js dependencies..."
        PKG_MANAGER="bun"
    elif command_exists pnpm; then
        print_status "Using pnpm for Node.js dependencies..."
        PKG_MANAGER="pnpm"
    elif command_exists yarn; then
        print_status "Using yarn for Node.js dependencies..."
        PKG_MANAGER="yarn"
    elif command_exists npm; then
        print_status "Using npm for Node.js dependencies..."
        PKG_MANAGER="npm"
    else
        print_warning "No Node.js package manager found. Skipping commitlint setup."
        print_warning "Install Node.js and npm/yarn/pnpm/bun to enable commit message validation."
        return 1
    fi
    
    # Create package.json if it doesn't exist
    if [ ! -f "package.json" ]; then
        print_status "Creating package.json..."
        cat > package.json << EOF
{
  "name": "power-desk",
  "version": "0.1.0",
  "description": "ESP32-C3 based power management device",
  "private": true,
  "devDependencies": {
    "@commitlint/cli": "^18.0.0",
    "markdownlint-cli2": "^0.10.0"
  },
  "scripts": {
    "commitlint": "commitlint",
    "lint:md": "markdownlint-cli2 '**/*.md'"
  }
}
EOF
    fi
    
    # Install dependencies
    print_status "Installing Node.js dependencies..."
    case $PKG_MANAGER in
        bun)
            bun install
            ;;
        pnpm)
            pnpm install
            ;;
        yarn)
            yarn install
            ;;
        npm)
            npm install
            ;;
    esac
    
    print_success "Node.js tools setup complete"
}

# Test the setup
test_setup() {
    print_status "Testing development tools setup..."
    
    # Test Rust tools
    print_status "Testing Rust tools..."
    if cargo fmt --version >/dev/null 2>&1; then
        print_success "✓ cargo fmt is working"
    else
        print_error "✗ cargo fmt is not working"
    fi
    
    if cargo clippy --version >/dev/null 2>&1; then
        print_success "✓ cargo clippy is working"
    else
        print_error "✗ cargo clippy is not working"
    fi
    
    # Test lefthook
    if command_exists lefthook; then
        print_success "✓ lefthook is installed"
        if lefthook version >/dev/null 2>&1; then
            print_success "✓ lefthook is working"
        fi
    else
        print_warning "✗ lefthook is not installed"
    fi
    
    # Test commitlint
    if command_exists commitlint || command_exists bunx || command_exists npx; then
        print_success "✓ commitlint is available"
    else
        print_warning "✗ commitlint is not available"
    fi
    
    print_success "Setup test complete"
}

# Main execution
main() {
    echo "🚀 Power Desk Development Environment Setup"
    echo "=========================================="
    
    setup_rust
    echo
    
    setup_lefthook
    echo
    
    setup_nodejs_tools
    echo
    
    test_setup
    echo
    
    print_success "🎉 Development tools setup complete!"
    echo
    print_status "Next steps:"
    echo "  1. Make a test commit to verify hooks are working"
    echo "  2. Run 'cargo fmt' to format your code"
    echo "  3. Run 'cargo clippy' to check for issues"
    echo "  4. Use conventional commit format: 'type(scope): description'"
    echo
    print_status "Example commit: 'feat(wifi): add automatic reconnection'"
}

# Run main function
main "$@"
