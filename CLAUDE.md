# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**spihelper** is a Wikipedia user script for managing Sockpuppet Investigations (SPI). It runs in-browser on Wikipedia and provides an interactive interface for clerks, CheckUsers, and administrators to:
- Block and tag suspected sockpuppet accounts
- Manage SPI case statuses and workflows
- Archive completed investigations
- Generate links to analysis tools
- Post administrative comments

The script is deployed directly to Wikipedia user pages via GitHub Actions and loaded as a gadget.

## Development Commands

### Building
The codebase is **modular for development** but **monolithic for deployment**. Source code lives in `src/` and must be built before deployment:

```bash
python3 build.py  # Merges src/*.js files into spihelper.built.js
npm run build     # Alias for build.py
```

**Modular source structure:**
- `src/config-and-globals.js` (~500 lines) - Settings, constants, templates, global state
- `src/api-and-utilities.js` (~1000 lines) - MediaWiki API wrappers, utility functions
- `src/ui-and-forms.js` (~850 lines) - UI generation, form building, event handlers
- `src/actions-blocking-tagging.js` (~200 lines) - Block/tag operations
- `src/actions-archive-move.js` (~380 lines) - Archive/move/merge operations
- `src/main-orchestration.js` (~720 lines) - Main entry points, action orchestration

**Development workflow:**
1. Edit files in `src/`
2. Run `python3 build.py` to generate `spihelper.built.js`
3. Test the built file
4. When ready, rename `spihelper.built.js` to `spihelper.js` for deployment

### Linting
```bash
npm test          # Run ESLint on spihelper.js
npm ci            # Clean install dependencies (used in CI)
```

### Deployment
This project uses **Python-based deployment** to Wikipedia, not traditional build tools.

**Development deployment (automatic on push to `develop`):**
```bash
python3 deploy.py --file spihelper.js --target User:GeneralNotability/spihelper-dev.js --summary "Description"
python3 deploy.py --file spihelper.css --target User:GeneralNotability/spihelper.css --summary "Description"
```

**Production deployment (automatic on push to `main`):**
- Deploys to `User:GeneralNotability/spihelper.js`
- Requires bot credentials in GitHub secrets (BOT_NAME, BOT_PASS)
- See `.github/workflows/deploy.yml` and `.github/workflows/dev-deploy.yml`

### Branch Strategy
- `develop` - Main development branch (deploy target for dev)
- `main` - Production branch (deploy target for prod)
- PRs target `develop` by default

## Code Architecture

### Modular Source, Single-File Deployment
**For development:** Code is split across 6 modules in `src/` (~200-1000 lines each) for AI-friendliness and maintainability.

**For deployment:** Build script merges modules into `spihelper.js` (~3,600 lines). There is no module system - this is a Wikipedia user script loaded directly into the browser.

**Why this approach:** Wikipedia scripts must be monolithic (no import/export), but the 3600-line file exceeded AI context windows. The modular structure makes development easier while preserving deployment compatibility.

### High-Level Structure

The codebase follows a **three-view, event-driven architecture**:

```
Page Load → spiHelperAddLink()
    ↓
User clicks "SPI" portlet
    ↓
VIEW 1: spiHelperInit() → Display Top Menu
    - Checkbox-based action selection
    - Section selector dropdown
    - Continue button
    ↓
User selects actions + clicks "Continue"
    ↓
VIEW 2: spiHelperGenerateForm() → Display Action Forms
    - Dynamically generated sub-forms based on selected actions
    - Block/tag tables, comment areas, case status dropdowns
    - "Perform actions" button
    ↓
User fills forms + clicks "Perform actions"
    ↓
VIEW 3: spiHelperPerformActions() → Execute Operations
    - Collect form data into global arrays
    - Execute wiki operations (block, tag, archive, etc.)
    - Show status updates
    - Log to user's personal log page
```

### Key Global State

**Configuration:**
- `spiHelperSettings` - User-configurable options loaded from `Special:MyPage/spihelper_options.js`
- Includes watchlist preferences, role flags, logging preferences, and feature toggles

**Page State:**
- `spiHelperPageName` - Current SPI case page name
- `spiHelperCaseName` - Extracted case name (e.g., "Username" from "Wikipedia:Sockpuppet investigations/Username")
- `spiHelperCaseSections` - Array of investigation sections parsed from the page
- `spiHelperSectionId` / `spiHelperSectionName` - Currently selected section

**Action Data (accumulated during form interaction):**
- `spiHelperActionsSelected` - Object tracking which action checkboxes are enabled
- `spiHelperBlocks[]` - Array of `BlockEntry` objects (username, duration, block flags)
- `spiHelperTags[]` - Array of `TagEntry` objects (username, tag type, altmaster info)
- `spiHelperGlobalLocks[]` - Array of usernames to globally lock

### Operation Execution Flow

`spiHelperPerformActions()` orchestrates operations in this sequence:

1. **Data Collection** - Read all form inputs into local variables
2. **Link Generation** (if enabled) - Generate external analysis tool URLs
3. **Wiki Text Manipulation** - Update case status templates and archive notice flags
4. **Blocking & Tagging** (parallel) - Execute blocks/tags using `Promise.all()`
5. **Category Creation** - Auto-create sockpuppet categories if needed
6. **Case Restructuring** - Archive or move sections if requested
7. **Logging** - Write to user's personal log (`Special:MyPage/spihelper_log`)
8. **Status Display** - Show completion status and "Back to top menu" button

### Permission System

The script adapts its interface based on user role:

- **spiHelperIsAdmin()** - Checks for 'sysop' group → enables blocking
- **spiHelperIsCheckuser()** - Checks for 'checkuser' group → enables CU-specific templates
- **spiHelperIsClerk()** - Checks clerk setting or CU status → enables case management

UI elements are hidden/shown via CSS classes:
- `.spiHelper_adminClass` - Admin-only content
- `.spiHelper_checkuserClass` - CheckUser-only content
- `.spiHelper_clerkClass` - Clerk-only content

Function `updateForRole()` dynamically shows/hides these based on permissions.

### MediaWiki API Layer

Core API wrapper functions:
- `spiHelperGetAPI(title)` - Returns initialized `mw.Api` instance
- `spiHelperGetPageText(title, displayStatus, progressTarget)` - Fetches page wikitext
- `spiHelperEditPage(title, text, summary, minorEdit, watch, watchExpiry)` - Edits a page
- `spiHelperWikiBlockUser(username, duration, reason, ...)` - Blocks a user via API
- `spiHelperGetUserBlockReason(username)` - Gets current block reason

All API calls are Promise-based and handle errors with status display updates.

### Template Parsing

The script parses and manipulates these wiki templates:
- `{{SPI case status|...}}` - Case workflow status (open, closed, etc.)
- `{{SPI archive notice|...}}` - Archive metadata (xwiki, deny, notalk flags)
- `{{sockpuppet|...}}` / `{{sockpuppeteer|...}}` - User page tags
- `{{checkuserblock}}` / `{{checkuserblock-account}}` - CU block notices
- `{{clerknote}}` / `{{adminnote}}` - Case page comments

Regexes for parsing are defined as constants (e.g., `spiHelperCaseStatusRegex`, `spiHelperArchiveNoticeRegex`).

## Code Style & Conventions

### ESLint Configuration
- Uses `eslint-config-standard` and `eslint-config-wikimedia`
- **No semicolons** (`semi: ["error", "never"]`)
- ES2017 syntax, jQuery environment
- Browser globals enabled

### Naming Conventions
- All script globals prefixed with `spiHelper` to avoid namespace conflicts
- Functions use camelCase: `spiHelperBlockUser()`, `spiHelperTagUser()`
- TypeScript JSDoc annotations for key data structures (see `@typedef` blocks at top)

### Data Structures

**BlockEntry:**
```javascript
{
  username: string,     // Username to block
  duration: string,     // Block duration (e.g., "indefinite", "1 week")
  acb: boolean,        // Account creation blocked
  ab: boolean,         // Autoblock enabled (registered) / logged-in users blocked (IPs)
  ntp: boolean,        // Talk page access blocked
  nem: boolean,        // Email access blocked
  tpn: string          // Talk page notice type
}
```

**TagEntry:**
```javascript
{
  username: string,       // Username to tag
  tag: string,           // Tag type ("suspected", "proven", "confirmed", "blocked")
  altmasterTag: string,  // Alternate master tag type
  blocking: boolean      // Whether this account is also being blocked
}
```

## Important Constraints

### Wikipedia-Specific Context
- This script runs in the **MediaWiki browser environment** with access to:
  - `mw` (MediaWiki JavaScript API)
  - `$` (jQuery)
  - `importStylesheet()`, `importScript()` (MW gadget loaders)
  - `displayMessage()` (custom dialog library from User:Timotheus Canens)

### No Build Step
- Code must be deployable as-is to Wikipedia
- No transpilation, bundling, or minification
- Dependencies are loaded via `importScript()` at runtime

### Edit Conflict Detection
- Script stores `spiHelperStartingRevID` on page load
- Before editing, fetches fresh page text to detect concurrent edits
- User is warned if page changed since script loaded

### Asynchronous Operations Tracking
- `spiHelperActiveOperations` Map tracks in-flight operations
- `beforeunload` event warns users if they try to navigate away during operations

## Testing Notes

- No automated tests exist beyond ESLint
- Testing happens manually on Wikipedia test pages
- Development version deployed to `User:GeneralNotability/spihelper-dev.js`
- Test on `Wikipedia:Sockpuppet investigations/Test` or similar pages

## Common Modification Patterns

### Adding a New Action
1. Add entry to `spiHelperActionsSelected` object
2. Add checkbox to `spiHelperTopViewHTML` template
3. Add form controls to `spiHelperActionViewHTML` template
4. Update `spiHelperGenerateForm()` to show/hide controls based on checkbox
5. Update `spiHelperPerformActions()` to execute the new action
6. Update `updateForRole()` if action is role-restricted

### Adding a New User Setting
1. Add default value to `spiHelperSettings` object
2. Add to `spiHelperValidSettings` if discrete values (or validate in `spiHelperLoadSettings()`)
3. Document in user settings page (not in repo - lives on Wikipedia)

### Modifying Block/Tag Logic
- Block logic: `spiHelperBlockUser()` and `spiHelperWikiBlockUser()`
- Tag logic: `spiHelperTagUser()`
- Both functions handle CheckUser-specific templates, IP ranges, and global locks

### Changing UI Layout
- HTML templates: `spiHelperTopViewHTML`, `spiHelperActionViewHTML`
- CSS: `spihelper.css` (deployed separately to Wikipedia)
- Dynamic table generation: `spiHelperGenerateBlockTableLine()`, `spiHelperGenerateLinkTableLine()`
