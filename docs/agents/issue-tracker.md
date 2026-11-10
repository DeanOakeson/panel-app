# Issue tracker: Jira (primary) and GitHub Issues (bug reports)

Two surfaces, deliberately split:

* **Jira**, project PANEL at https://panel-app.atlassian.net: the source of truth for the product backlog, the current sprint and bugs. Stories, bugs and sprint commitments live there, not in GitHub. A bug is a Bug issue with the `bug` label.
* **GitHub Issues (DeanOakeson/panel-app)**: occasional bug reports. A human triages them and moves the ones to fix into Jira. A GitHub issue closing does not mean the work is scheduled.

The team's docs, such as the Database Schema page, live in the Confluence space PA on the same site.

## How the agent interacts with Jira

* Read an issue by its key, such as PANEL-36, through an Atlassian MCP server or the Jira REST API when one is set up. Otherwise the human supplies the story text, and that text is the authoritative ticket.
* Statuses, in order: **To Do → In Progress → In Review → Done**.
* Every pull request title includes its Jira key. See `AGENTS.md`.

Guardrails:

* Do NOT invent issue keys, statuses or assignees. Only echo what Jira or the human shows.
* Create, edit or move Jira issues only when the human asks.

## How the agent interacts with GitHub Issues

Use the `gh` CLI (repo inferred from `git remote`).

* **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`
* **List open bugs**: `gh issue list --state open --json number,title,labels`
* **Comment**: `gh issue comment <number> --body "..."`
* **Labels**: `gh issue edit <number> --add-label "..."`

Do NOT file issues autonomously. Bring a suspected bug to the human first, and file it only when they say so.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

* A feature or story: draft it for Jira as a user story with acceptance criteria. Create it in PANEL only when the human asks.
* A confirmed bug, only after the human approves: a Bug issue in PANEL with the `bug` label.

## When a skill says "fetch the relevant ticket"

Read the Jira issue by its key when access is set up. Otherwise use the story text the human supplied. If a GitHub issue number is referenced, use `gh issue view <number>`.
