#!/usr/bin/env bash
# What withdraw-waiting-runs.sh decides, against a gh that answers from this
# file and reaches nobody: which runs it cancels, which it leaves, and what
# it says when GitHub does not answer. Run by the workflows job of ci.yml.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The stand-in: the waiting runs, the pull requests of their branches by
# owner and state, and a record of everything asked for.
cat > "$work/gh" <<'STANDIN'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GH_ASKED"
case "$1 $2 ${3:-}" in
  "api --paginate "*)
    jq -c '{id, branch, owner}' <<'RUNS'
{"id": 101, "branch": "feat/merged", "owner": "kuutti-fi"}
{"id": 102, "branch": "feat/open", "owner": "kuutti-fi"}
{"id": 103, "branch": "feat/closed-and-opened-again", "owner": "kuutti-fi"}
{"id": 104, "branch": "feat/nobody", "owner": "kuutti-fi"}
{"id": 105, "branch": "feat/unreadable", "owner": "kuutti-fi"}
{"id": 106, "branch": "feat/stubborn", "owner": "kuutti-fi"}
{"id": 107, "branch": null, "owner": "kuutti-fi"}
{"id": 108, "branch": "feat/no-repository", "owner": null}
{"id": 109, "branch": "feat/went-by-itself", "owner": "kuutti-fi"}
RUNS
    ;;
  "api -X GET")
    state="" head=""
    for arg in "$@"; do
      case "$arg" in state=*) state="${arg#state=}" ;; head=*) head="${arg#head=}" ;; esac
    done
    # Nothing is ever asked by the branch's name alone.
    case "$head" in kuutti-fi:*) ;; *) echo "asked without the owner: $head" >&2; exit 2 ;; esac
    case "$state $head" in
      "closed kuutti-fi:feat/merged") echo "#11" ;;
      "open kuutti-fi:feat/open") echo "#12" ;;
      "closed kuutti-fi:feat/closed-and-opened-again") echo "#13" ;;
      "open kuutti-fi:feat/closed-and-opened-again") echo "#14" ;;
      *" kuutti-fi:feat/unreadable") echo "API rate limit exceeded" >&2; exit 1 ;;
      "closed kuutti-fi:feat/stubborn") echo "#16" ;;
      "closed kuutti-fi:feat/went-by-itself") echo "#19" ;;
      *) echo "" ;;
    esac
    ;;
  "api -X POST")
    case "$4" in
      */runs/106/cancel) echo "HTTP 500: something went wrong" >&2; exit 1 ;;
      */runs/109/cancel) echo "HTTP 409: Cannot cancel a workflow run that is completed" >&2; exit 1 ;;
    esac
    ;;
  "api repos/"*)
    case "$2" in
      */runs/106) echo waiting ;;
      */runs/109) echo completed ;;
      *) echo "unexpected run read: $2" >&2; exit 2 ;;
    esac
    ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
STANDIN
chmod +x "$work/gh"

export PATH="$work:$PATH" GH_TOKEN=none GITHUB_REPOSITORY=kuutti-fi/kuutti-app GH_ASKED="$work/asked"
failures=0
expect() { # expect <what> <text> <file>
  if grep -qF -- "$2" "$3"; then echo "ok    $1"; else echo "FAIL  $1: no \"$2\" in:"; cat "$3"; failures=$((failures + 1)); fi
}
cancelled() { grep -E '^api -X POST ' "$GH_ASKED" | awk '{print $4}' || true; }

: > "$GH_ASKED"
status=0
"$here/withdraw-waiting-runs.sh" > "$work/out" 2>&1 || status=$?
expect "a merged pull request's run is withdrawn" "run 101 (kuutti-fi:feat/merged): #11 closed, none open; withdrawn" "$work/out"
expect "an open pull request's run is left" "run 102 (kuutti-fi:feat/open): #12 is open; left waiting" "$work/out"
expect "a branch with a closed and an open pull request is left" "run 103 (kuutti-fi:feat/closed-and-opened-again): #14 is open; left waiting" "$work/out"
expect "a branch without a pull request is left, with a warning" "::warning::run 104 (kuutti-fi:feat/nobody): no pull request of that branch was found; left waiting" "$work/out"
expect "what cannot be read is left, with GitHub's words" "::warning::run 105 (kuutti-fi:feat/unreadable): its pull requests could not be read, left waiting: API rate limit exceeded" "$work/out"
expect "a cancellation that fails is named" "::error::still waiting, to be cancelled by hand (gh run cancel <id>): 106" "$work/out"
expect "a run without a branch is left" "::warning::run 107 names no branch or no repository; left waiting" "$work/out"
expect "a run whose repository is gone is left" "::warning::run 108 names no branch or no repository; left waiting" "$work/out"
expect "a run that stopped waiting by itself is no failure" "run 109 (kuutti-fi:feat/went-by-itself): no longer waiting (completed); nothing to withdraw" "$work/out"
expect "the count is of what was withdrawn" "withdrawn: 1" "$work/out"
if [ "$status" = 1 ]; then echo "ok    a failed cancellation fails the script"; else echo "FAIL  exit $status, expected 1"; failures=$((failures + 1)); fi
printf 'repos/kuutti-fi/kuutti-app/actions/runs/101/cancel\nrepos/kuutti-fi/kuutti-app/actions/runs/106/cancel\nrepos/kuutti-fi/kuutti-app/actions/runs/109/cancel\n' > "$work/wanted"
if diff "$work/wanted" <(cancelled) > "$work/diff"; then echo "ok    three cancellations were asked for, and no other"; else echo "FAIL  the cancellations asked for:"; cat "$work/diff"; failures=$((failures + 1)); fi
if grep -q "asked without the owner" "$work/out"; then echo "FAIL  pull requests were asked for by the branch's name alone"; failures=$((failures + 1)); else echo "ok    pull requests are asked for by owner and branch"; fi

: > "$GH_ASKED"
DRY_RUN=true "$here/withdraw-waiting-runs.sh" > "$work/out" 2>&1
expect "a dry run says which" "run 101 (kuutti-fi:feat/merged): #11 closed, none open; would be withdrawn" "$work/out"
expect "a dry run says which, the stubborn one too" "run 106 (kuutti-fi:feat/stubborn): #16 closed, none open; would be withdrawn" "$work/out"
if [ -n "$(cancelled)" ]; then echo "FAIL  a dry run cancelled something:"; cancelled; failures=$((failures + 1)); else echo "ok    a dry run cancels nothing"; fi

[ "$failures" = 0 ] || { echo "$failures failed"; exit 1; }
echo "withdraw-waiting-runs.sh decides as it says"
