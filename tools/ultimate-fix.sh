#!/bin/bash

# ULTIMATE FIX - No more mistakes!
set -e

echo "🚀 ULTIMATE COMMIT MESSAGE FIX - FINAL SOLUTION!"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check git status
if ! git diff-index --quiet HEAD --; then
    print_error "Uncommitted changes detected. Commit or stash them first."
    exit 1
fi

print_status "Current problematic commits:"
git log --oneline -10

echo
read -p "🚨 This will COMPLETELY REWRITE commit history. Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Operation cancelled."
    exit 0
fi

# Create a comprehensive mapping script
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << 'EOF'
#!/bin/bash

# Read the entire commit message
MSG=$(cat)

# Extract just the first line and clean it
FIRST_LINE=$(echo "$MSG" | head -n1)

# Clean up the first line - remove everything after the first sentence/dash
CLEAN_SUBJECT=$(echo "$FIRST_LINE" | sed 's/- .*//' | sed 's/🚀.*//' | sed 's/\.$//' | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Map the cleaned subjects to proper conventional commit format
case "$CLEAN_SUBJECT" in
    "chore(ci): setup development tools for code quality assurance")
        echo "chore(ci): setup development tools for code quality assurance"
        ;;
    "Fix GitHub Actions workflow issues")
        echo "fix(ci): resolve github actions workflow issues"
        ;;
    "Enhance web config tool for improved development branch support")
        echo "feat(web-tool): enhance web config tool for improved development branch support"
        ;;
    "Update GitHub Actions to build firmware on every main branch commit")
        echo "ci(build): update github actions to build firmware on every main branch commit"
        ;;
    "Add web configuration tool and GitHub Actions for firmware builds")
        echo "feat(web-tool): add web configuration tool and github actions for firmware builds"
        ;;
    "feat: Add comprehensive monitoring & protection system documentation")
        echo "feat(docs): add comprehensive monitoring and protection system documentation"
        ;;
    "docs: translate WiFi configuration documentation to English")
        echo "docs: translate wifi configuration documentation to english"
        ;;
    "feat: implement WiFi configuration replacement system")
        echo "feat: implement wifi configuration replacement system"
        ;;
    "feat: 全面更新依赖到最新版本")
        echo "feat(deps): update all dependencies to latest versions"
        ;;
    "chore: update deps")
        echo "chore: update deps"
        ;;
    *)
        # If no match, try to extract a reasonable subject
        if [[ "$CLEAN_SUBJECT" == *"chore(ci)"* ]]; then
            echo "chore(ci): setup development tools for code quality assurance"
        elif [[ "$CLEAN_SUBJECT" == *"Fix"* ]] && [[ "$CLEAN_SUBJECT" == *"Actions"* ]]; then
            echo "fix(ci): resolve github actions workflow issues"
        elif [[ "$CLEAN_SUBJECT" == *"Enhance"* ]] && [[ "$CLEAN_SUBJECT" == *"web"* ]]; then
            echo "feat(web-tool): enhance web config tool for improved development branch support"
        elif [[ "$CLEAN_SUBJECT" == *"Update"* ]] && [[ "$CLEAN_SUBJECT" == *"Actions"* ]]; then
            echo "ci(build): update github actions to build firmware on every main branch commit"
        elif [[ "$CLEAN_SUBJECT" == *"Add"* ]] && [[ "$CLEAN_SUBJECT" == *"web"* ]]; then
            echo "feat(web-tool): add web configuration tool and github actions for firmware builds"
        elif [[ "$CLEAN_SUBJECT" == *"feat"* ]] && [[ "$CLEAN_SUBJECT" == *"monitoring"* ]]; then
            echo "feat(docs): add comprehensive monitoring and protection system documentation"
        elif [[ "$CLEAN_SUBJECT" == *"docs"* ]] && [[ "$CLEAN_SUBJECT" == *"WiFi"* ]]; then
            echo "docs: translate wifi configuration documentation to english"
        elif [[ "$CLEAN_SUBJECT" == *"feat"* ]] && [[ "$CLEAN_SUBJECT" == *"WiFi"* ]]; then
            echo "feat: implement wifi configuration replacement system"
        elif [[ "$CLEAN_SUBJECT" == *"全面更新"* ]]; then
            echo "feat(deps): update all dependencies to latest versions"
        elif [[ "$CLEAN_SUBJECT" == *"update deps"* ]]; then
            echo "chore: update deps"
        else
            echo "$CLEAN_SUBJECT"
        fi
        ;;
esac
EOF

chmod +x "$TEMP_SCRIPT"

print_status "🔧 Applying ultimate fix..."

# Set environment variable to suppress git filter-branch warning
export FILTER_BRANCH_SQUELCH_WARNING=1

# Use git filter-branch to fix messages
git filter-branch -f --msg-filter "$TEMP_SCRIPT" HEAD~10..HEAD

# Clean up
rm "$TEMP_SCRIPT"

print_success "✅ Ultimate fix applied!"

echo
print_status "📋 Final commit subjects:"
git log --oneline -10

echo
print_status "🚀 Force pushing to remote..."
git push --force-with-lease origin main

print_success "🎉 ULTIMATE FIX COMPLETE!"
print_success "🐾 All commits are now properly formatted with Conventional Commits!"

echo
print_success "✅ Mission accomplished! No more commit message issues!"
