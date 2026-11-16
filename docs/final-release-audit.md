# LinguaLens final release audit

Audit date is 16 November 2026 in Asia/Calcutta. The release was tested on Windows x64 with Python 3.13.13, Node.js 24.13.0, Next.js 16.4.6, headless Edge, SQLite and embedded PostgreSQL 18.6. The browser used the production standalone frontend and a loopback FastAPI process with a worker. Test accounts, runs and reports used isolated databases. Dependency checks used current advisory feeds.

**Final-year academic demonstration — PASS locally.** The labeled, credential-free showcase and full evaluation and reporting workflow operate using persisted demonstration trials.

**Public production deployment — BLOCKED.** The target container stack, live provider calls, deployed HTTPS and access controls, and backup/restore need verification in the intended environment.

The release run passed **49 backend tests**, **2 frontend unit tests**, TypeScript, the production builds, and **all three Playwright suites**. The browser quality suite recorded zero accessibility violations, page or unexpected console errors, and horizontal overflow on the scanned layouts.

## Audit results

| Area | Status | Evidence |
| --- | --- | --- |
| Phase 1 landing, guest demo and account access | PASS | Browser exercised the interactive landing tree and synthetic comparison CSV, then authenticated through the workspace. The synthetic chart, demo labels and workspace history were inspected. |
| Phase 2 ambiguity | PASS | Ran the curated PP attachment item. Checked distinct parses, reference comparison, tree node selection, keyboard and pointer pan, zoom, branch collapse and expand, fullscreen and SVG/PNG export. |
| Phase 2 recursion and movement | PASS | Ran both analyzers. Checked recursion depth and the expanded tree, plus origin, destination and indexed traces for movement. Backend reference regressions cover wrong expansions, wrong origins and invalid trees. |
| Phase 2 phonology | PASS | Ran a saved rule and tested an unseen phone string. Backend verified held-out controls, case-sensitive phones and duplicate or conflicting reference forms. |
| Datasets, prompts and execution | PASS | Ran CSV and JSON imports, dataset duplication, prompt creation and exact preview, persisted runs, failed request handling, retries and cancellation. Verified that all 16 candidate benchmark items import. |
| Phase 3 automated scoring | PASS | Checked versioned rubrics, weighted and missing scores, deterministic evidence, attempts and retries. Simulated judge success, malformed replies and timeout passed. |
| Human grading and consensus | PASS | Two independent blind browser reviewers submitted grades and an administrator adjudicated. Regression covers stale output, disagreement, and separate live and demo agreement. A controlled mixed-source fixture yielded one eligible pair per population with 100% demo agreement and 0% simulated-live agreement. |
| Comparisons, analytics and leaderboard | PASS | Verified filtering by population and rubric, matched protocols, missing-score suppression, reported model-version drift and paired inference. Recomputed all release demonstration aggregates from persisted responses. |
| Consistency | PASS | Verified 20 matched groups of two, denominators, exact and structural agreement, score variance, and undefined intervals for a constant sample. The semantic service HTTP, dimensions, cosine and timeout paths passed against simulated responses. |
| Reports and exports | PASS | Browser generated report LL-1 and downloaded PDF, CSV and JSON. Compared all 40 rows with stored scoring attempts and the frozen database specification. Extracted text and inspected the rendering of all three A4 PDF pages. Checked all 15 report type and format combinations, attachment and no-store headers, and owner-only download access. |
| Phase 4 Showcase and UI | PASS | Checked desktop, laptop, tablet and mobile widths of 1,440, 1,200, 820 and 390 px, plus light theme. The quality suite made 36 measured navigations and 34 axe scans. Manual screenshot review covered the populated comparison and analyzer views and the responsive Showcase. |
| Database migrations | PASS | Fresh SQLite migration plus seeded `0004` → `0005` upgrades on SQLite and PostgreSQL 18.6. The existing account remained usable, new trial and evaluation work settled, provider diagnostics persisted and report smoke checks passed. `alembic check` detected zero schema drift. |
| Security checks | PASS within local scope | Tested authorization, cross-origin write refusal, encrypted account credentials, auth quotas, upload limits, private cache headers, cookie settings and export ownership. npm reported zero known advisories in production and full trees. pip-audit reported zero known advisories across 59 installed Python packages. |
| Compose configuration | PASS statically | Validated the Compose schema, migration dependency, readiness and startup gates, volume, loopback port binding and non-root container directives. [Compose specification schema](https://github.com/compose-spec/compose-spec/blob/main/schema/compose-spec.json) |
| Live hosted model generation and judging | BLOCKED | The host has no configured provider key in its available environment or enabled saved account credential. Run the bounded live check with an authorized key or a private live generation model. Judging needs a separate configured model. |
| Live Ollama and semantic similarity | BLOCKED | No Ollama service answered the default loopback probe. Configure the internal endpoint and install the exact generation or embedding model for the check. |
| Docker Compose runtime | BLOCKED | Docker CLI and daemon were unavailable. Run the documented startup procedure on a Docker host and repeat login, migration, worker, analysis and exports against the deployed images. |
| Production ingress, backups and operations | BLOCKED | A target environment is required to exercise real TLS, cookie forwarding and rate limits, operational monitoring, and backup/restore. |
| Independent benchmark verification | BLOCKED | The pilot annotations are candidates. Independent linguistic review is required before treating the pilot as an expert-validated benchmark. |

## Corrected findings

| Before the fix | After the fix |
| --- | --- |
| FAIL — The agreement panel combined demo and live reviews and could count judgments of replaced output. | PASS — Selects and labels a single source, defaults to live, and uses reviews of the current settled response. Historical reviews remain readable. |
| FAIL — Adjudication could unblock the disputed majority in Human mode and alter its correctness denominator. | PASS — A decision changes the Consensus verdict. Human mode keeps its original evidence and disputed state. Newly calculated analytics and repeat summaries use v3 metric identifiers, and prior frozen reports keep their recorded values. |
| FAIL — Some analyzer and experiment labels described the simplified baseline as the reference profile. | PASS — Baseline, reference and live selections remain visibly distinct, including in analyzer execution and inspection. |
| FAIL — Dataset and report CSV paths used different spreadsheet text protections. | PASS — Both use the same plain-text formatting for formula-like strings, including full-width characters. The JSON export preserves exact text for re-import. Spreadsheet application behavior is outside the verified application boundary. [OWASP CSV guidance](https://community.owasp.org/attacks/CSV_Injection) |

## Research evidence

The independent cross-check used the Playwright run with its copied dataset and saved prompt revision. The cohort had 10 items, two demo profiles and two trials per profile and item. There were 40 weighted scores and decisive verdicts. The demo reference averaged 100 and the demo baseline 30, with ranks 1 and 2. The pooled stimulus mean was 65, and 20 of 40 decisive verdicts were correct. The paired difference was 70 points across 10 stimuli. The constant differences yielded an unavailable interval. Each of the 20 matched repeat groups had two trials and matched in classification, structure, exact text and decisive verdict. These figures characterize the authored fixture.

Analytics filter the selected source before pooling scores and agreement. Rank eligibility checks stored items, dataset and prompt revisions, parameters, repetitions, scoring configuration, coverage and reported model-version drift. Failed provider requests without output have no linguistic verdict. Missing weighted criteria stay unavailable. When providers omit serving metadata, version drift can go undetected. Inference relies on the recorded protocol and the assumptions in the [research methodology](research-methodology.md).

## Reproduce on Windows

Use Python 3.13 and Node.js. From the backend directory, create a virtual environment and install the backend and test dependencies. For this audit, `DATABASE_URL` used an isolated SQLite database whose name included `phase3-browser`. On a separate disposable PostgreSQL database, rehearse the upgrade with seeded records at `0004`, then verify those records after upgrading. Preserve the project database before operational migration.

```powershell
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
$env:DATABASE_URL='sqlite:///./phase3-browser-release.sqlite3'
$env:WEB_ORIGIN='http://localhost:3000'
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m alembic check
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

From a separate frontend terminal run the production build and start the website.

```powershell
cd frontend
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run check
npm.cmd run start
```

From another frontend terminal point the browser suite at the exact API test database and website origin. Install the Playwright browser first or use a locally installed Edge browser.

```powershell
$env:RESEARCH_BASE_URL='http://localhost:3000'
$env:RESEARCH_BROWSER_CHANNEL='msedge'
$env:RESEARCH_EVALUATION_TEST_DATABASE='sqlite:///./phase3-browser-release.sqlite3'
npm.cmd run test:browser
npm.cmd run test:evaluation
npm.cmd run test:quality
npm.cmd audit --omit=dev
npm.cmd audit
```

For stronger path portability use an absolute SQLite URL in both terminals. The evaluation harness runs the reviewer-role CLI from the backend directory. Set `RESEARCH_SCREENSHOTS_DIR` to retain the evaluation downloads and `RESEARCH_QUALITY_CAPTURES` to retain the visual audit images. A separate `pip-audit` environment can scan the installed backend package directory without changing project dependencies. This audit saved browser downloads and renders under `.cache/final-release-exports` and route captures under `.cache/final-release-quality`.

## Remaining risks and submission handoff

- For the presentation, start the local stack, sign in, and open **Research Showcase → Review the featured experiment**. Reserve time to rehearse the two reviewer logins and exports. [Faculty demo guide](final-demo-guide.md)
- For public rollout, complete live model and embedding checks, run the exact Compose environment, verify TLS and trusted ingress with the actual host, and rehearse restore into a separate database. Docker uses PostgreSQL 17 in the supplied configuration. The local database smoke check used 18.6, so image-version verification remains open. [Deployment guide](deployment-guide.md)
- Local accessibility scans cover the listed routes, widths and interactions. User testing with assistive technology and native PDF accessibility are outside this audit. The Python test suite emitted the existing Starlette/httpx test-client deprecation warning.
- This checkout has no Git commits or release tag. Package the source and documentation for submission, excluding environment credentials, the workspace database and temporary audit captures. The ignore rules cover these private paths.

[Phase 4 baseline](final-testing-report.md) · [Project documentation index](final-project-completion.md)
