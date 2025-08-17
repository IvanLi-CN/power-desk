# Development Setup Guide

This guide explains how to set up the development environment for the Power Desk project with automated code quality checks.

## Overview

The project uses three main tools to ensure code quality:

1. **lefthook** - Git hooks manager for pre-commit checks
2. **commitlint** - Commit message format validation
3. **rust-toolchain.toml** - Rust toolchain configuration

## Quick Setup

Run the setup script to install all development tools:

```bash
chmod +x tools/setup-dev-tools.sh
./tools/setup-dev-tools.sh
```

## Manual Setup

If you prefer to set up tools manually:

### 1. Rust Toolchain

The project uses a specific Rust toolchain configuration defined in `rust-toolchain.toml`:

```bash
# Install required components
rustup component add rust-src rustfmt clippy
rustup target add riscv32imc-unknown-none-elf
```

### 2. Git Hooks (lefthook)

Install lefthook for automated pre-commit checks:

```bash
# Install lefthook (choose one method)
go install github.com/evilmartians/lefthook@latest  # If you have Go
brew install lefthook                               # If you have Homebrew
# Or download from: https://github.com/evilmartians/lefthook/releases

# Install hooks
lefthook install
```

### 3. Commit Message Validation

Install commitlint for commit message format validation:

```bash
# Using bun (recommended)
bun add -D @commitlint/cli markdownlint-cli2

# Or using npm/yarn/pnpm
npm install -D @commitlint/cli markdownlint-cli2
```

## Code Quality Checks

### Pre-commit Hooks

The following checks run automatically before each commit:

1. **Code Formatting** (`cargo fmt`)
   - Automatically formats Rust code
   - Stages fixed files

2. **Code Linting** (`cargo clippy`)
   - Checks for common mistakes and improvements
   - Fails on warnings

3. **Build Check** (`cargo check`)
   - Ensures code compiles for the target platform

4. **Markdown Linting**
   - Validates markdown files for consistency

### Commit Message Format

Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
type(scope): description

[optional body]

[optional footer]
```

#### Allowed Types

- `feat` - New features
- `fix` - Bug fixes
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `chore` - Maintenance tasks
- `ci` - CI/CD changes
- `build` - Build system changes
- `revert` - Reverting changes

#### Allowed Scopes

- `core` - Core system functionality
- `config` - Configuration management
- `wifi` - WiFi connectivity
- `mqtt` - MQTT communication
- `i2c` - I2C bus communication
- `charge` - Charging system
- `protector` - Protection system
- `watchdog` - Watchdog functionality
- `bus` - Bus communication
- `web-tool` - Web configuration tool
- `ci` - Continuous integration
- `docs` - Documentation
- `tools` - Development tools
- `shell` - Hardware shell/enclosure
- `firmware` - Firmware-related changes
- `deps` - Dependencies

#### Examples

```bash
# Good commit messages
git commit -m "feat(wifi): add automatic reconnection on disconnect"
git commit -m "fix(charge): resolve current measurement accuracy issue"
git commit -m "docs(readme): update installation instructions"
git commit -m "refactor(i2c): simplify bus initialization logic"

# Bad commit messages (will be rejected)
git commit -m "fix stuff"                    # Missing scope, too vague
git commit -m "Add new feature"              # Wrong format
git commit -m "feat(invalid): new feature"   # Invalid scope
git commit -m "feat(wifi): 添加新功能"        # Contains Chinese characters
```

## Manual Code Quality Checks

You can run quality checks manually:

```bash
# Format code
cargo fmt

# Check for issues
cargo clippy --target riscv32imc-unknown-none-elf --all-features --workspace -- -D warnings

# Build check
cargo check --target riscv32imc-unknown-none-elf --all-features

# Lint markdown files
markdownlint-cli2 "**/*.md"
# or
bunx markdownlint-cli2 "**/*.md"
```

## Bypassing Hooks (Emergency)

In rare cases, you might need to bypass hooks:

```bash
# Skip pre-commit hooks
git commit --no-verify -m "emergency fix"

# Skip specific lefthook commands
LEFTHOOK=0 git commit -m "skip all hooks"
```

**Note:** Use this sparingly and fix issues in follow-up commits.

## Troubleshooting

### Common Issues

1. **"cargo fmt failed"**
   - Run `cargo fmt` manually to see specific formatting issues
   - Ensure all Rust files are properly formatted

2. **"cargo clippy failed"**
   - Run `cargo clippy --target riscv32imc-unknown-none-elf --all-features --workspace -- -D warnings`
   - Fix all warnings and errors

3. **"commitlint failed"**
   - Check commit message format
   - Ensure no Chinese characters in commit messages
   - Use allowed types and scopes

4. **"lefthook not found"**
   - Install lefthook using the setup script
   - Run `lefthook install` to set up hooks

### Getting Help

- Check the [lefthook documentation](https://github.com/evilmartians/lefthook)
- Review [Conventional Commits specification](https://www.conventionalcommits.org/)
- Run `./tools/setup-dev-tools.sh` to reinstall tools

## Configuration Files

- `lefthook.yml` - Git hooks configuration
- `commitlint.config.cjs` - Commit message rules
- `rust-toolchain.toml` - Rust toolchain specification
- `package.json` - Node.js dependencies for linting tools
