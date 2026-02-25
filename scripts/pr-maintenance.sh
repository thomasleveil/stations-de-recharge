#!/usr/bin/env bash
# PR Maintenance — stations-de-recharge
# Runs every hour; ensures all open PRs are:
#   1. Rebased (or merged) on origin/main
#   2. Mergeable (no unresolvable conflicts — Claude agent resolves intelligently)
#   3. Have a gh-pages preview deployed

REPO="thomasleveil/stations-de-recharge"
REPO_DIR="/home/thomas/workspace/personal/stations-de-recharge"
GH_PAGES_BASE="https://thomasleveil.github.io/stations-de-recharge"
LOG_DIR="$REPO_DIR/scripts/logs"
LOG_FILE="$LOG_DIR/maintenance-$(date +%Y%m%d-%H%M%S).log"
STOP_HOUR=${STOP_HOUR:-19}

# Ensure SSH key is available in cron (no ssh-agent)
export GIT_SSH_COMMAND="ssh -i /home/thomas/.ssh/id_rsa -o IdentitiesOnly=yes -o BatchMode=yes"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

log() { echo "$*"; }

# Time guard — don't run past stop hour
CURRENT_HOUR=$(date +%-H)
if [ "$CURRENT_HOUR" -ge "$STOP_HOUR" ]; then
  log "⏹  Past stop time (${STOP_HOUR}h) — exiting."
  exit 0
fi

cd "$REPO_DIR"

log "════════════════════════════════════════════"
log "PR Maintenance — $(date '+%Y-%m-%d %H:%M:%S')"
log "════════════════════════════════════════════"

# Ensure we're on main and up to date
git checkout -q main
git fetch origin --quiet --prune
git pull -q --ff-only origin main 2>/dev/null || true

# Get all open PRs (newest first)
mapfile -t PR_ENTRIES < <(gh pr list --repo "$REPO" --state open --json number,headRefName \
  --jq '.[] | "\(.number) \(.headRefName)"')

if [ ${#PR_ENTRIES[@]} -eq 0 ]; then
  log "No open PRs found."
  exit 0
fi

# Snapshot current gh-pages pr/ directories
DEPLOYED_PRS=$(git ls-tree origin/gh-pages:pr/ --name-only 2>/dev/null || echo "")

NEEDS_DEPLOY=()
declare -a REPORT_LINES=()

# ── resolve_with_claude ───────────────────────────────────────────────────────
# Called when git merge hits conflicts.
# Launches a claude -p agent with full project + PR context to resolve
# the conflicts intelligently (preserving both feature and main contributions).
resolve_with_claude() {
  local pr_num="$1"
  local branch="$2"
  local conflict_files="$3"

  log "│  🤖 Calling Claude agent to resolve conflicts in: $conflict_files"

  # Gather PR context
  local pr_title pr_body
  pr_title=$(gh pr view "$pr_num" --repo "$REPO" --json title --jq '.title' 2>/dev/null || echo "Unknown")
  pr_body=$(gh pr view "$pr_num" --repo "$REPO" --json body --jq '.body' 2>/dev/null | head -40 || echo "")

  # Build the agent prompt
  local prompt
  prompt=$(cat <<PROMPT
Tu es un agent de résolution de conflits git pour le projet **stations-de-recharge**.

## Contexte du projet

Application web de carte des stations de recharge EV en France (pas de build, vanilla JS).

Fichiers principaux :
- \`app.js\` — logique principale (~1 400 lignes) : init carte Leaflet, filtrage DuckDB WASM, markers, routing OSRM
- \`index.html\` — shell HTML, charge les dépendances CDN et définit la structure du panel
- \`style.css\` — styles du panel, markers, popups, route-results, drive-panel
- \`BACKLOG.md\` — suivi des fonctionnalités (tableau markdown avec statuts 💡/🔍/📋/✅)
- \`filter-worker.js\` — Web Worker pour le filtrage du corridor

## Ce que la branche main a récemment ajouté (commits depuis le fork de cette PR)

- **U-2** : panneau de résultats scrollable des stations sur l'itinéraire (#route-results dans index.html, showRouteResults() dans app.js, styles dans style.css)
- **U-7** : mode conduite — panneau bas plein-écran (#drive-panel, enterDriveMode(), exitDriveMode(), refreshDrivePanel() dans app.js)
- **B-1** : fix GPS pending state pour calculateRoute()
- **Favicon, URL partageable, déduplication des corridors** (commits récents sur main)
- **F-9b** : réseau préféré mis en évidence (checkboxes dans settings, preferredNetworks, applyPreferredStyling())

## Ce que la PR #${pr_num} (branche ${branch}) implémente

Titre : ${pr_title}

Description :
${pr_body}

## Situation actuelle

Un \`git merge origin/main\` vient d'être lancé sur la branche \`${branch}\`.
Il a produit des conflits dans les fichiers suivants : **${conflict_files}**

Ces fichiers contiennent des marqueurs de conflit git :
\`\`\`
<<<<<<< HEAD        ← contenu de la branche feature (${branch})
... code de la feature ...
=======
... code venant de main ...
>>>>>>> origin/main ← contenu de main
\`\`\`

## Ta mission

1. **Lis** chaque fichier en conflit (ils sont dans le répertoire courant : ${REPO_DIR})
2. **Comprends** ce que chaque côté apporte :
   - Côté HEAD (${branch}) : la feature décrite ci-dessus
   - Côté origin/main : les fonctionnalités U-2, U-7, B-1 et autres listées ci-dessus
3. **Résous intelligemment** chaque conflit en **préservant les deux apports** :
   - Ne supprime pas le code de la feature
   - Ne supprime pas le code de main (U-2, U-7, etc.)
   - Pour BACKLOG.md : conserve les entrées des deux côtés (fusionner les tableaux)
   - Pour app.js : place les nouvelles fonctions côte à côte (évite les doublons)
   - Pour index.html/style.css : intègre les deux ensembles de changements
4. **Valide** tes corrections : assure-toi qu'il ne reste aucun marqueur <<<<<, =======, >>>>>>>
5. **Stage** les fichiers résolus : \`git add <fichiers>\`
6. **Finalise** le merge : \`git commit --no-edit\`

Travaille directement dans le répertoire courant. N'utilise pas git merge --abort.
N'utilise pas -X ours ou -X theirs.
PROMPT
)

  # Launch claude agent (unset CLAUDECODE to allow nested session)
  local claude_log="$LOG_DIR/claude-pr${pr_num}-$(date +%H%M%S).log"
  if env -u CLAUDECODE claude -p "$prompt" \
    --allowedTools "Bash,Read,Edit,Write" \
    --output-format text \
    > "$claude_log" 2>&1; then
    log "│  ✓ Claude agent finished — checking git state..."
    # Verify no conflict markers remain
    if git diff --check 2>/dev/null; then
      log "│  ✓ No conflict markers remaining"
      return 0
    else
      log "│  ⚠️  Claude left conflict markers — see $claude_log"
      return 1
    fi
  else
    log "│  ✗ Claude agent failed — see $claude_log"
    return 1
  fi
}

for entry in "${PR_ENTRIES[@]}"; do
  PR_NUM=$(echo "$entry" | cut -d' ' -f1)
  BRANCH=$(echo "$entry" | cut -d' ' -f2)

  log ""
  log "┌─ PR #$PR_NUM  $BRANCH"

  # ── 1. REBASE / MERGE ────────────────────────────────────────────────────
  # Use gh API (HTTPS) to check branch existence — avoids SSH issues in cron
  if ! gh api "repos/$REPO/branches/$BRANCH" --silent 2>/dev/null; then
    log "│  ⚠️  Branch not found on remote — skipping"
    REPORT_LINES+=("PR #$PR_NUM ($BRANCH): ⚠️  branch missing on remote")
    continue
  fi

  git checkout -q "$BRANCH"
  git reset --hard -q "origin/$BRANCH"

  BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo "0")
  AHEAD=$(git rev-list origin/main..HEAD --count 2>/dev/null || echo "0")

  if [ "$BEHIND" -eq 0 ]; then
    log "│  ✓ Up to date with main ($AHEAD commits ahead)"
    REPORT_LINES+=("PR #$PR_NUM ($BRANCH): ✓ up to date ($AHEAD ahead)")
  else
    log "│  ↑ $BEHIND commits behind main — attempting rebase..."

    # 1st attempt: clean rebase (no conflicts)
    REBASE_OK=0
    git rebase --autostash -q origin/main 2>/tmp/rebase-err-"$PR_NUM".txt && REBASE_OK=1 || true

    if [ "$REBASE_OK" -eq 1 ]; then
      git push --force-with-lease -q origin "$BRANCH"
      log "│  ✓ Rebased cleanly and pushed"
      REPORT_LINES+=("PR #$PR_NUM ($BRANCH): ✓ rebased on main")
    else
      # Conflicts during rebase — switch to merge strategy + Claude agent
      git rebase --abort 2>/dev/null || true
      git reset --hard -q "origin/$BRANCH"

      log "│  ↩ Rebase had conflicts — switching to merge + Claude agent..."

      # Start the merge (will produce conflict markers in files)
      git merge --no-edit origin/main 2>/tmp/merge-err-"$PR_NUM".txt || true

      CONFLICT_FILES=$(git diff --name-only --diff-filter=U | tr '\n' ' ')

      if [ -z "$CONFLICT_FILES" ]; then
        # Merge succeeded without conflicts
        git push -q origin "$BRANCH"
        log "│  ✓ Merged main cleanly (no conflicts) — pushed"
        REPORT_LINES+=("PR #$PR_NUM ($BRANCH): ✓ merged main, mergeable")
      else
        # Delegate conflict resolution to Claude
        if resolve_with_claude "$PR_NUM" "$BRANCH" "$CONFLICT_FILES"; then
          git push -q origin "$BRANCH"
          log "│  ✓ Claude resolved conflicts — pushed"
          REPORT_LINES+=("PR #$PR_NUM ($BRANCH): ✓ Claude-resolved merge, mergeable")
        else
          git merge --abort 2>/dev/null || git reset --hard "origin/$BRANCH" 2>/dev/null || true
          log "│  ✗ Could not resolve — manual intervention required"
          REPORT_LINES+=("PR #$PR_NUM ($BRANCH): ✗ UNRESOLVED — $CONFLICT_FILES")
        fi
      fi
    fi
  fi

  # ── 2. GH-PAGES PREVIEW ──────────────────────────────────────────────────
  git checkout -q "$BRANCH" 2>/dev/null || true
  git reset --hard -q "origin/$BRANCH" 2>/dev/null || true

  if echo "$DEPLOYED_PRS" | grep -qx "$PR_NUM"; then
    log "│  ✓ Preview: $GH_PAGES_BASE/pr/$PR_NUM/"
  else
    log "│  ℹ️  No preview — queuing deployment"
    NEEDS_DEPLOY+=("$PR_NUM:$BRANCH")
  fi

  log "└──"
done

# ── 3. DEPLOY MISSING PREVIEWS ───────────────────────────────────────────────
if [ ${#NEEDS_DEPLOY[@]} -gt 0 ]; then
  log ""
  log "=== Deploying ${#NEEDS_DEPLOY[@]} missing preview(s) ==="

  TMPDIR=$(mktemp -d)

  for entry in "${NEEDS_DEPLOY[@]}"; do
    PR_NUM="${entry%%:*}"
    BRANCH="${entry#*:}"
    git checkout -q "$BRANCH"
    mkdir -p "$TMPDIR/pr/$PR_NUM"
    cp index.html app.js style.css filter-worker.js "$TMPDIR/pr/$PR_NUM/"
  done

  git checkout -q -B gh-pages-maint origin/gh-pages
  for entry in "${NEEDS_DEPLOY[@]}"; do
    PR_NUM="${entry%%:*}"
    mkdir -p "pr/$PR_NUM"
    cp "$TMPDIR/pr/$PR_NUM/"* "pr/$PR_NUM/"
  done

  git add pr/
  git commit -q -m "deploy: PR previews for PRs $(echo "${NEEDS_DEPLOY[@]}" | sed 's/:[^ ]*//g; s/ /,/g')"
  git push -q origin HEAD:gh-pages
  git checkout -q main
  git branch -D gh-pages-maint 2>/dev/null || true
  rm -rf "$TMPDIR"

  for entry in "${NEEDS_DEPLOY[@]}"; do
    PR_NUM="${entry%%:*}"
    BRANCH="${entry#*:}"
    SHA=$(git rev-parse --short "origin/$BRANCH" 2>/dev/null || echo "HEAD")
    BODY="## 🔍 Prévisualisation disponible

**URL :** $GH_PAGES_BASE/pr/$PR_NUM/

> Déployé depuis \`$SHA\` — se met à jour à chaque push sur cette PR."
    gh pr comment "$PR_NUM" --repo "$REPO" --body "$BODY" 2>/dev/null
    log "  ✓ Deployed + commented PR #$PR_NUM"
  done
fi

git checkout -q main

# ── 4. SUMMARY ───────────────────────────────────────────────────────────────
log ""
log "════ SUMMARY ════"
for line in "${REPORT_LINES[@]}"; do
  log "  $line"
done
log ""
log "Done — $(date '+%H:%M:%S')"
log "Next run: $(date -d 'next hour' '+%H:%M')"
