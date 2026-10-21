# Issue tracker: ClickUp (primary) + GitHub Issues (bug reports)

Two surfaces, deliberately split:

- **ClickUp** — source of truth for the product backlog and the current sprint backlog. Feature work, user stories, and sprint commitments live there, not in GitHub.
- **GitHub Issues (DeanOakeson/panel-app)** — bug reports only. Bugs filed here are triaged by a human later and promoted into the next sprint backlog in ClickUp according to urgency. A GitHub issue closing a bug does not mean the work is scheduled.

## How the agent interacts with ClickUp (for now)

No API/MCP access is wired up yet. The human supplies ClickUp content directly in conversation (story text, acceptance criteria, ticket status). Treat supplied story text as the authoritative ticket.

Sprint item statuses, in order: **to-do → in progress → complete**, with **blocked** as a side state. When writing feature work summaries, map to these names.

Guardrails:

- Do NOT invent ClickUp task numbers, statuses, or assignments; only echo what the human supplied.
- A possible ClickUp MCP may be added later once the SCRUM team agrees. Until then, treat any instruction to "update ClickUp" as needing human hands, and prefer read-mostly, low-noise behavior so the team's ClickUp page is never disrupted.

## How the agent interacts with GitHub Issues

Use the `gh` CLI (repo inferred from `git remote`).

- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`
- **List open bugs**: `gh issue list --state open --json number,title,labels`
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."`

Bug reports: do NOT file issues autonomously. Bring a suspected bug to the human individually first; file only when they say so. Early-sprint note: bug handling is deprioritized for now (Sprint 1) — don't build workflows around it.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

- A feature/story → present it for the human to enter in ClickUp (draft the story text in ClickUp style: user story + acceptance criteria + sprint status).
- A confirmed bug (only after human approval) → `gh issue create`.

## When a skill says "fetch the relevant ticket"

Use the story text the human supplied in conversation; if a GitHub issue number is referenced, `gh issue view <number>`.
