#!/usr/bin/env python3
"""The workflow invariants of #8, checked on every run so they cannot rot:

- no pull_request_target or workflow_run triggers;
- every workflow's top-level permissions are exactly contents: read;
- packages: write only in build.yml, contents: write only in release.yml,
  id-token: write only in jobs that exchange the OIDC token;
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


for path in sorted(ROOT.glob("*.yml")):
    doc = yaml.safe_load(path.read_text())
    name = path.name
    triggers = doc.get("on") if "on" in doc else doc.get(True)  # PyYAML reads a bare `on` as True
    if isinstance(triggers, dict):
        for bad in ("pull_request_target", "workflow_run"):
            if bad in triggers:
                problems.append(f"{name}: uses the {bad} trigger")
    if doc.get("permissions") != {"contents": "read"}:
        problems.append(f"{name}: top-level permissions must be exactly contents: read")
    for job_id, job in (doc.get("jobs") or {}).items():
        if "uses" in job:  # a reusable-workflow call; its own file is checked on its own
            continue
        perms = job.get("permissions") or {}
        if perms.get("packages") == "write" and name != "build.yml":
            problems.append(f"{name}/{job_id}: packages: write belongs only in build.yml")
        if perms.get("contents") == "write" and name != "release.yml":
            problems.append(f"{name}/{job_id}: contents: write belongs only in release.yml")
        text = steps_text(job)
        exchanges_token = "aws-oidc.sh" in text or "ACTIONS_ID_TOKEN_REQUEST_URL" in text
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
print(f"workflow invariants hold across {len(list(ROOT.glob('*.yml')))} workflows")
