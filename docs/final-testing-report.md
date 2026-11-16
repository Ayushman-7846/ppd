# Final testing report

The 16 November 2026 verification used Windows x64 with 16 logical processors, Python 3.13.13, Node.js 24.13.0, Next.js 16.4.6, headless Edge, SQLite and embedded PostgreSQL 18.6. The browser ran the production Next.js standalone output against a local FastAPI worker. Test databases were isolated from the regular workspace.

The final suite passed 47 backend tests, two frontend unit tests, the TypeScript check, the production build, and three Playwright suites.

## Quality gates

| Gate | Status | Evidence and next action |
| --- | --- | --- |
| Phase 1 and 2 and all four analyzers | PASS | Playwright ran authentication, the four curated analyzers, tree interactions and exports, history, dataset imports, prompts and a batch. |
| Phase 3 evaluation and research integrity | PASS | End-to-end suite duplicated a dataset, saved a prompt version and ran 40 authored demo trials from that exact protocol. Two blind browser sessions submitted independent grades. The owner adjudicated, opened comparison, consistency, analytics and the leaderboard. Regression tests cover missing values, score versioning, annotation evidence and fairness. |
| Provider diagnostics | PASS | Mocked catalog success, timeout, missing credential, result persistence, owner isolation, offset timestamps, stale-reset behavior, and credential-safe payloads. Browser settings display the observed status. |
| Live model inference on all four tasks | BLOCKED | No hosted provider credential appeared in the available server configuration or saved enabled provider metadata. The default Ollama endpoint did not answer. Configure a test key or private Ollama generation model and run `scripts/live_provider_check.py --execute`. |
| Live AI judge | BLOCKED | Simulated success and failure paths pass. Configure an authorized distinct model and repeat the bounded script with judge flags. |
| Live semantic similarity | BLOCKED | Ollama did not answer on the default local endpoint. The mock HTTP contract covers normalized vectors, missing rows, timeout and sanitized failure. Install and configure an embedding-capable `SEMANTIC_MODEL` to finish. |
| SQLite and PostgreSQL migrations | PASS | Applied revision `0005` from `0004` on both engines, logged in with the existing fixture account, and confirmed Alembic found no drift. Smoke checks saved a response, assessment and diagnostics record and exported the report. |
| PDF, CSV and JSON | PASS | Real downloads from 40 stored demo assessments. CSV/JSON rows and the JSON report specification agreed with the database. The three A4 PDF pages were rendered and checked for scope, values, methodology and numbering. |
| UI and accessibility review | PASS for tested surfaces | 36 measured navigations, 34 axe A/AA scans with zero violations, and no page errors or horizontal overflow on the covered layouts. Viewports were 1,440, 1,200, 820 and 390 px. Exercised light theme on two pages, keyboard skip link and drawer focus return, and pointer/keyboard pan, collapse, zoom, fullscreen and tree export. Local coverage cannot certify accessibility on all assistive technology. |
| Local application security and dependency scans | PASS | Tested origin controls, login limits, registration policy, encrypted account credentials, reviewer roles, isolated experiments and exports, provider errors and upload sizes. npm reported zero production advisories. pip-audit flagged `cryptography` 49.0.0. Version 50.0.2 passed the rerun over 59 packages. [Security advisory](https://github.com/advisories/GHSA-g6cj-pr64-35w5) |
| Benchmark research review | BLOCKED | All 16 candidate items import, with two positive and two negative targets per task. Independent linguistics review is still required for a gold benchmark. |
| Compose configuration | PASS statically | Validated against the official Compose JSON schema. Checked database volume, migration dependency, loopback boundaries, health checks and non-root image directives. [Compose schema](https://github.com/compose-spec/compose-spec/blob/main/schema/compose-spec.json) |
| Docker container runtime | BLOCKED | Docker CLI and daemon were unavailable. The standalone artifact ran locally. Verify `docker compose up --build --wait` and rehearse health, migration, login, dataset, trial and report checks on a Docker host. |
| Deployed TLS, ingress controls and restore drill | NOT TESTED | No public deployment was performed. Verify HTTPS/cookies, trusted proxy and rate limits, restore into staging, and version rollback before public rollout. |

## Local measurements

`scripts/measure_workspace.py` measured 20 warmed requests per endpoint in FastAPI TestClient. The before and after runs used separate copies of the same 40-trial dataset. There were no request failures. These are serial local measurements, with scheduler and environment variation.

| Endpoint | SQL statements before → after | p50 ms before → after | p95 ms before → after |
| --- | ---: | ---: | ---: |
| Assessment list, 20 rows | 63 → 6 | 30.01 → 11.84 | 32.50 → 22.32 |
| Comparison | 5 → 5 | 29.79 → 36.46 | 43.89 → 56.20 |
| Analytics | 6 → 6 | 39.73 → 41.29 | 48.88 → 48.07 |
| Consistency | 5 → 5 | 19.65 → 25.16 | 23.13 → 41.97 |
| PDF export | 2 → 2 | 40.51 → 77.51 | 46.05 → 90.95 |

The assessment list batches attempts, rubrics, reviewer matches and judge snapshots. It returned the same payload size of 36,425 bytes. The other timings are reported as observed. This workload supports conclusions about the assessment query count. A sustained-load or WAN benchmark needs separate testing.

The production browser sweep recorded 100–235 ms from local navigation start to a visible heading and loaded fonts across 36 visits. The Showcase route loaded 316,085 encoded JavaScript bytes at 1,440 px after route splitting, down from 382,883 bytes in the earlier Phase 4 build. The initial comparison view went from 382,883 to 366,066 bytes. These are observed browser resource sizes and timings, with no network throttling or external provider calls.

## Run the checks

- From the backend virtual environment run `python -m pytest -q`, then `alembic check` on a migrated test database. Starlette reports an existing deprecation warning for the httpx test client.
- Run `npm test`, `npm run check`, and `npm run build` from the frontend directory.
- With the API and worker running, run `npm run test:browser`, `npm run test:evaluation`, and `npm run test:quality`. Set `RESEARCH_BASE_URL` for a custom origin. The evaluation suite needs `RESEARCH_EVALUATION_TEST_DATABASE` pointing to the same disposable database and provisions its own reviewer accounts. Set `RESEARCH_BROWSER_CHANNEL=msedge` for installed Edge.
- Audit dependencies with `npm audit --omit=dev` and `pip-audit --path <backend-site-packages>` using an independent audit environment. Record the date and repeat for the dependencies and operating-system packages in the deployment image.

[Phase 3 regression baseline](phase-3-audit.md) · [Deployment instructions](deployment-guide.md) · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
