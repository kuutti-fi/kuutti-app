#!/usr/bin/env python3
"""The workflow invariants of #8, checked on every run so they cannot rot:

- no pull_request_target or workflow_run triggers;
- every workflow's top-level permissions are exactly contents: read;
- packages: write and attestations: write only in build.yml, contents: write
  only in release.yml, security-events: write only in scorecard.yml,
  id-token: write only in jobs that exchange the OIDC token;
- actions: write only in the job of preview-cleanup.yml that cancels waiting
  runs (ADR-012 §8): a job without an environment, held to main by its own
  condition, in a workflow no pull request starts;
- a job's permissions are a list of scopes, never a word (write-all), and a
  job that calls a reusable workflow is held to the same scopes;
- every checkout sets persist-credentials: false;
- every third-party action is pinned to a 40-character commit SHA.
"""

import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1] / "workflows"
SHA_PIN = re.compile(r"^[^@]+@[0-9a-f]{40}$")
problems: list[str] = []


def steps_text(job: dict) -> str:
    return "\n".join(str(step.get("run", "")) for step in job.get("steps", []) or [])


# Both spellings: GitHub runs a .yaml as it runs a .yml.
WORKFLOWS = sorted([*ROOT.glob("*.yml"), *ROOT.glob("*.yaml")])

for path in WORKFLOWS:
    doc = yaml.safe_load(path.read_text())
    name = path.name
    on = doc.get("on") if "on" in doc else doc.get(True)  # PyYAML reads a bare `on` as True
    # A map, a list or one word: the names are what is checked.
    triggers = {str(t) for t in (on if isinstance(on, (dict, list)) else [on] if on else [])}
    for bad in ("pull_request_target", "workflow_run"):
        if bad in triggers:
            problems.append(f"{name}: uses the {bad} trigger")
    if doc.get("permissions") != {"contents": "read"}:
        problems.append(f"{name}: top-level permissions must be exactly contents: read")
    for job_id, job in (doc.get("jobs") or {}).items():
        perms = job.get("permissions") or {}
        if not isinstance(perms, dict):
            problems.append(f"{name}/{job_id}: permissions must name scopes, not {perms!r}")
            continue
        # A job that calls a reusable workflow hands it its scopes, so what it
        # may hold is what the workflow it calls may hold; one outside this
        # repository is handed nothing to write with.
        holder = name
        uses = str(job.get("uses", ""))
        if uses.startswith("./.github/workflows/"):
            holder = uses.removeprefix("./.github/workflows/")
        elif uses:
            holder = ""
            if any(value == "write" for value in perms.values()):
                problems.append(f"{name}/{job_id}: hands a write scope to a workflow outside this repository")
        if perms.get("packages") == "write" and holder != "build.yml":
            problems.append(f"{name}/{job_id}: packages: write belongs only in build.yml")
        if perms.get("attestations") == "write" and holder != "build.yml":
            problems.append(f"{name}/{job_id}: attestations: write belongs only in build.yml")
        if perms.get("security-events") == "write" and holder != "scorecard.yml":
            problems.append(f"{name}/{job_id}: security-events: write belongs only in scorecard.yml")
        if perms.get("contents") == "write" and holder != "release.yml":
            problems.append(f"{name}/{job_id}: contents: write belongs only in release.yml")
        # Cancelling a waiting run is all it is used for (ADR-012 §8). The
        # scope is wider than that: it also re-runs and deletes runs, starts
        # and disables workflows, approves the runs of fork pull requests and
        # deletes caches and artifacts. So it stays in one job, which runs
        # main's copy of one script and holds no secret.
        if perms.get("actions") == "write":
            if (name, job_id) != ("preview-cleanup.yml", "waiting"):
                problems.append(f"{name}/{job_id}: actions: write belongs only in preview-cleanup.yml/waiting")
            else:
                if "environment" in job:
                    problems.append(f"{name}/{job_id}: the job with actions: write takes no environment")
                if "github.ref == 'refs/heads/main'" not in str(job.get("if", "")):
                    problems.append(f"{name}/{job_id}: the job with actions: write runs from main only")
                if any(t.startswith("pull_request") for t in triggers):
                    problems.append(f"{name}: the workflow with actions: write is not started by a pull request")
        if "uses" in job:  # a reusable-workflow call; its steps are in its own file, checked on its own
            continue
        text = steps_text(job)
        # Two actions use the job's OIDC token themselves (#16): Scorecard to
        # publish its result, attest-build-provenance to sign the attestation.
        attests = name == "build.yml" and any(
            str(step.get("uses", "")).startswith("actions/attest-build-provenance@")
            for step in job.get("steps", []) or []
        )
        publishes_scorecard = name == "scorecard.yml" and any(
            str(step.get("uses", "")).startswith("ossf/scorecard-action@")
            and (step.get("with") or {}).get("publish_results") is True
            for step in job.get("steps", []) or []
        )
        exchanges_token = (
            "aws-oidc.sh" in text
            or "ACTIONS_ID_TOKEN_REQUEST_URL" in text
            or publishes_scorecard
            or attests
        )
        if perms.get("id-token") == "write" and not exchanges_token:
            problems.append(f"{name}/{job_id}: id-token: write without an OIDC exchange step")
        if exchanges_token and perms.get("id-token") != "write":
            problems.append(f"{name}/{job_id}: exchanges an OIDC token without id-token: write")
        for step in job.get("steps", []) or []:
            uses = step.get("uses")
            if not uses:
                continue
            if uses.startswith("actions/checkout@") and (step.get("with") or {}).get("persist-credentials") is not False:
                problems.append(f"{name}/{job_id}: checkout without persist-credentials: false")
            if not uses.startswith("./") and not SHA_PIN.match(uses):
                problems.append(f"{name}/{job_id}: {uses} is not pinned to a commit SHA")

for path in sorted((ROOT.parent / "actions").glob("*/action.yml")):
    doc = yaml.safe_load(path.read_text())
    for step in (doc.get("runs") or {}).get("steps", []) or []:
        uses = step.get("uses")
        if uses and not uses.startswith("./") and not SHA_PIN.match(uses):
            problems.append(f"{path.relative_to(ROOT.parent)}: {uses} is not pinned to a commit SHA")

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"workflow invariants hold across {len(WORKFLOWS)} workflows")
