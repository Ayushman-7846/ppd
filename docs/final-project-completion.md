# LinguaLens project completion report

LinguaLens is ready to rehearse and demonstrate locally using curated trials. Public production rollout remains gated by the deployment environment, live provider checks, and operational validation. The pilot benchmark remains a candidate review corpus.

## Implemented modules

| Area | Outcome |
| --- | --- |
| Website and analyzers | Existing landing, account workspace, four analyzers, tree viewer, dataset and prompt tools, and experiment laboratory remain available. **Research Showcase** links the methods to the real modules and offers an editable 40-trial curated preset. |
| Evaluation | Deterministic, AI-assisted, human, consensus and adjudication records retain the exact response and scoring evidence. |
| Analytics and outputs | Matched comparisons, repeatability, statistics, leaderboard, and frozen PDF/CSV/JSON exports retain provenance. |
| Provider readiness | Safe per-user catalog diagnostics show configured model, last success, latency and sanitized failures. The opt-in live check runs through the actual API. |
| Production foundations | Migration-gated Compose, non-root images, explicit cookie, origin, registration and shared-credential settings, and persistent authentication throttles. |
| Research contribution | The application turns the study's behavioral tasks into a reproducible run, grading and reporting workflow. It adds controlled repeats and independent human review. Candidate reference data have an explicit review state. |

## Phase 4 change inventory

- The database and API changed in `models.py`, `auth.py`, `config.py`, `catalog_api.py`, `providers.py`, `lab_schemas.py`, `main.py`, `semantic.py`, and Alembic revision `0005`.
- Assessment performance work changed `evaluation_api.py` and `evaluation_service.py` and added `scripts/measure_workspace.py`.
- Website changes include `frontend/app/lab/showcase/page.tsx`, `components/research-showcase.tsx`, provider settings, the experiment preset, navigation, theme-aware styles, tree layout, accessible chart grouping and deferred research charts.
- Deployment changes include both Dockerfiles, `docker-compose.yml`, environment templates, Next.js configuration and the patched backend dependency.
- Verification and research materials include `backend/tests/test_readiness.py`, Playwright suites and axe, `scripts/live_provider_check.py`, `datasets/benchmark-v1/`, and the documents below.

## Documentation index

- [Project overview](project-overview.md)
- [System architecture and data flow](system-architecture.md)
- [Database design and ER diagram](database-design.md)
- [Research methodology](research-methodology.md)
- [Final testing report and readiness table](final-testing-report.md)
- [Deployment guide and external verification](deployment-guide.md)
- [User manual](user-manual.md)
- [Final demo guide](final-demo-guide.md)
- [Research limitations](research-limitations.md)

Further research can validate a larger independent corpus, pre-register new stimuli and evaluation rules, calibrate human and model graders and compare controlled live experiments. Further deployment work is covered by the outstanding gates in the testing report.
