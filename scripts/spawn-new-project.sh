#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# spawn-new-project.sh
# Bootstraps a new quiz-funnel project folder for a specified
# product + demographic, with a pre-filled INSTRUCTIONS.md that
# can be pasted into a fresh Claude Code session.
#
# Usage:
#   ./scripts/spawn-new-project.sh
# or
#   ./scripts/spawn-new-project.sh "IUL" "Nurses" "Nurse Secure"
# ─────────────────────────────────────────────────────────────────────

set -e

# ─── Inputs (positional args or interactive prompts) ─────────────────
PRODUCT="${1:-}"
DEMOGRAPHIC="${2:-}"
BRAND="${3:-}"

prompt_for() {
    local var_name=$1
    local question=$2
    local current_value="${!var_name}"
    if [ -z "$current_value" ]; then
        read -rp "$question " value
        eval "$var_name=\"\$value\""
    fi
}

echo
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Spawn a new quiz-funnel project                              ║"
echo "║  (Based on the Trucker Benefit blueprint)                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo

prompt_for PRODUCT      "1. Product type? (e.g. IUL, term life, mortgage protection):"
prompt_for DEMOGRAPHIC  "2. Target demographic? (e.g. Nurses, Veterans, Real estate agents):"

if [ -z "$BRAND" ]; then
    # Suggest a brand name from the demographic
    suggested=$(echo "$DEMOGRAPHIC" | awk '{print $1}' | sed 's/s$//')
    suggested="${suggested} Secure"
    read -rp "3. Brand name? [default: $suggested]: " BRAND
    BRAND="${BRAND:-$suggested}"
fi

# Folder name = brand without special chars
FOLDER_NAME=$(echo "$BRAND" | sed 's/[^A-Za-z0-9 -]//g' | tr -s ' ')
PARENT_DIR="${HOME}/Documents"
PROJECT_DIR="${PARENT_DIR}/${FOLDER_NAME}"

echo
echo "─────────────────────────────────────────────────────"
echo "  Product:      $PRODUCT"
echo "  Demographic:  $DEMOGRAPHIC"
echo "  Brand:        $BRAND"
echo "  Project dir:  $PROJECT_DIR"
echo "─────────────────────────────────────────────────────"
echo
read -rp "Looks good? Create the project? [Y/n]: " confirm
case "$confirm" in
    [nN]|[nN][oO]) echo "Cancelled."; exit 0 ;;
esac

# ─── Create the project folder ───────────────────────────────────────
if [ -d "$PROJECT_DIR" ]; then
    echo "⚠ Folder already exists: $PROJECT_DIR"
    read -rp "Use it anyway? [y/N]: " use_existing
    case "$use_existing" in
        [yY]|[yY][eE][sS]) ;;
        *) echo "Cancelled."; exit 1 ;;
    esac
else
    mkdir -p "$PROJECT_DIR"
    echo "✅ Created: $PROJECT_DIR"
fi

# ─── Write INSTRUCTIONS.md inside the new project ────────────────────
INSTRUCTIONS_PATH="${PROJECT_DIR}/INSTRUCTIONS.md"
cat > "$INSTRUCTIONS_PATH" <<EOF
# Paste this entire file as the FIRST message to a fresh Claude Code session.

---

I want to build a quiz-based lead-gen funnel for **${PRODUCT}** targeting **${DEMOGRAPHIC}**.

Working brand name: **${BRAND}** (open to refining if you suggest something stronger.)

Use the complete architecture, file structure, code patterns, and integrations
described in BLUEPRINT.md from this reference repo:

  https://raw.githubusercontent.com/leadsdon/trucker-benefit/main/BLUEPRINT.md

Reference implementation (a fully-working IUL funnel for CDL truckers, in
production at truckerbenefit.com):

  https://github.com/leadsdon/trucker-benefit

## Before writing any code

Run the discovery process from BLUEPRINT.md STEP 1 — ask me all 22 questions
in ONE structured message. Wait for my answers before building.

The 22 questions cover:
  A. Brand (name, domain, color palette, tagline)
  B. Product (type, value prop, coverage range, key benefit)
  C. Audience (demographic, age range, pain points, compliance)
  D. Quiz data points (PII fields, qualifying Q, quality signals,
     underwriting Q, budget Q, call preference, final field)
  E. Operator handoff (CRM destination, call number, brand voice)

Propose 12-14 quiz questions following the framework in STEP 3
(Qualifier → Vision/Reality → Fear/Pain → Underwriting → PII).
I'll approve or edit.

## Once I answer, build the complete system:

- index.html — landing + quiz with auto-advance, phase indicator,
  biased progress bar, phone confirmation step
- thank-you.html — loading flourish, product match reveal, big call
  CTA, share section
- privacy.html + terms.html — TCPA-compliant boilerplate
- favicon.svg — brand monogram
- vercel.json — security headers
- api/lead.js — fan-out proxy (Supabase + Apps Script + outbound
  webhook + Meta CAPI) with hard-blocked sources, phone-required
  gate, lead-quality filter, server-side CAPI fire with dedup event_id
- api/admin.js — token-gated admin data endpoint
- api/capi.js — Meta CAPI endpoint for browser-driven Contact event
- lib/capi.js — shared Meta CAPI helper (SHA-256 hashes all PII)
- lib/lead-quality.js — phone + email junk filter
- backend/apps-script-backend.gs — Google Apps Script (master sheet,
  client sheet, Ringy push, testAuth, cleanupTestRows helpers)
- backend/supabase-schema.sql — Postgres tables
- backend/SUPABASE.md + backend/BACKEND.md — setup walkthroughs
- SETUP.md — operator go-live checklist (filled in for this project)
- BLUEPRINT.md + NEW_PROJECT_PROMPT.md — copy these in so this
  project itself can also be replicated

## Critical guarantees (do NOT skip any of these):

- **Phone required** at quiz validation + page beforeunload + server-side
  /api/lead. No phone = lead dropped entirely (not even to Supabase).
- **Lead quality filter** — fake phones (555 area, all same digit) and
  fake emails (test@example.com, mailinator domains) block CAPI fire.
- **Hard-blocked sources** list at /api/lead (smoketest, debug,
  internal_test, deploy_check, etc.) — drop on the floor, no writes.
- **CAPI fires ONLY for valid complete real leads.** Never test/junk.
- **Same event_id** on browser pixel + server CAPI = Meta dedup.
- **Direct-visit gate on /thank-you.html** — pixel only fires if
  sessionStorage has a pending lead. Otherwise redirect home.
- **Outbound webhooks ONLY for leads with usable phone.**
- **Funnel in admin dashboard counts UNIQUE VISITORS per question**,
  not raw events.
- **TrustedForm script + TCPA consent text + timestamp** captured
  on the phone-confirmation step.
- **noindex on /thank-you.html.**
- **Outbound webhook payload flat at top-level** (not nested under
  userData). Include both \`firstName\` and \`first_name\` casings so
  GHL / Zapier / any CRM can map without transforms.
- **Webhook payload includes computed \`bio\` paragraph + \`bio_short\`
  one-liner + structured \`notes\` block** with quality grade.
- **Admin dashboard hidden behind passcode + URL hash** (/#admin).
- **Auto-advance on multiple-choice tap** (250ms delay).
- **Phone confirmation step** — show typed number, "Yes that's right" / "Edit".

## After build, output:

1. Full file tree of what you created
2. The operator's SETUP.md filled in for THIS project (env vars to
   set, accounts to create, exact values to use where determined)
3. A list of design decisions you made (so I can review)
4. A list of decisions you DEFERRED to me (exact fear-story names,
   final color hex codes, anything you weren't sure on)
5. A one-paragraph summary of the funnel I can use to brief a buyer

Don't ask me to confirm before discovery — start with the discovery
questions immediately.

---
EOF

echo "✅ Wrote: $INSTRUCTIONS_PATH"

# ─── Initialize git ──────────────────────────────────────────────────
cd "$PROJECT_DIR"
if [ ! -d ".git" ]; then
    git init -q -b main
    cat > .gitignore <<'GITIGNORE'
.DS_Store
.vscode/
.idea/
*.swp
.env
.env.local
.env.*.local
*.log
.vercel
node_modules/
GITIGNORE
    echo "✅ Initialized git repo (main branch)"
fi

# ─── Final instructions ──────────────────────────────────────────────
cat <<NEXT

═════════════════════════════════════════════════════════════════
  ✅ PROJECT READY: $BRAND
═════════════════════════════════════════════════════════════════

Next steps (~30 seconds):

  1. cd "$PROJECT_DIR"
  2. claude
  3. When Claude opens, paste the contents of INSTRUCTIONS.md:
       cat INSTRUCTIONS.md | pbcopy
     (then paste with Cmd+V in Claude's input box)

  4. Answer Claude's discovery questions.
  5. Claude builds the entire system.

After Claude finishes:
  - Operator tasks (Vercel, Supabase, Meta, GHL) → see SETUP.md
    that Claude will create
  - Push to a new GitHub repo:
       gh repo create ${FOLDER_NAME// /-} --private --source=. --remote=origin --push
    (or do it manually via github.com/new)
  - Connect Vercel to that repo for auto-deploy

═════════════════════════════════════════════════════════════════
NEXT
