# LinguaLens

LinguaLens is a final-year engineering project for evaluating how large language models analyze syntax and phonology. It combines four analyzers, persisted experiments, automated evaluation, blind human review, matched comparisons, and research reports. Use the curated demo without external credentials, or configure a live provider from your research account.

## Run with Docker Compose

Install Docker with the Compose plugin, set a unique URL-safe `POSTGRES_PASSWORD` in your local root `.env`, and start the services.

```powershell
Copy-Item .env.example .env
# Set POSTGRES_PASSWORD in .env before running the next command.
docker compose up --build
```

Open [LinguaLens](http://localhost:3000), [Research Showcase](http://localhost:3000/lab/showcase), or [the API reference](http://localhost:8000/docs). Compose waits for PostgreSQL, runs Alembic in a one-time service, and starts the API and production frontend on loopback. `docker compose down` stops the services and retains the database volume. [Deployment guide](docs/deployment-guide.md)

## Run locally

Requirements are Node.js 20.9 or later, Python 3.12 or 3.13, and npm. The API defaults to a local SQLite file. To use PostgreSQL directly, create a database and configure `DATABASE_URL` in `backend/.env` using `backend/.env.example` as a starting point. Set `WEB_ORIGIN` to the exact browser origin if you change the frontend address.

Terminal 1, from the project root:

```powershell
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

Terminal 2, from the project root:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

On macOS and Linux, use `.venv/bin/python` and `npm`. Visit [localhost:3000](http://localhost:3000). The Next.js server proxies API requests to `http://127.0.0.1:8000` by default. Set `BACKEND_URL` in `frontend/.env.local` to change it. For a production frontend build, set the backend address before building.

## Demonstration

Open **Research Showcase** from the landing page or workspace. The featured preset queues 40 curated trials after review and confirmation. [Faculty demonstration guide](docs/final-demo-guide.md)

1. Switch the prepositional phrase attachment in the landing page tree and read the two interpretations.
2. Open the dashboard and toggle model series or inspect the score values as a table. Model identities, scores, and sample experiment records are synthetic.
3. Register from **My workspace** and run a built-in item with **LinguaLens reference · Demo** in each analyzer. The saved response includes its raw text, normalized result, and validation details.
4. In **Experiment Laboratory**, select datasets and repetitions, then run and inspect saved trials.
5. Use [the provider setup and analyzer demonstration](docs/phase-2.md) for live configuration and [the Phase 3 scenario](docs/phase-3.md) for evaluation, review, and reporting.

## Checks

Run `python -m pytest -q` from `backend/` with the virtual environment active, and run `npm test` and `npm run build` from `frontend/`. On Windows, `scripts/check.ps1` runs the suite and the production build. Use `alembic check` against a migrated database to detect changes missing a migration. With both services running, `npm run test:browser` exercises Phase 2 in Playwright. Use the [isolated browser test setup](docs/phase-3.md#files-and-verification) for `npm run test:evaluation`.

- [Research requirements and paper analysis](docs/research.md)
- [Architecture, schema, and API](docs/architecture.md)
- [Phase 2 setup, demo, and file inventory](docs/phase-2.md)
- [Phase 3 evaluation methods, statistics, and demonstration](docs/phase-3.md)
- [Phase 3 engineering and research-integrity audit](docs/phase-3-audit.md)
- [Phase 4 project completion and documentation index](docs/final-project-completion.md)
- [Phase 4 testing and deployment gates](docs/final-testing-report.md)
- [Final release audit](docs/final-release-audit.md)
- [Implementation roadmap](docs/roadmap.md)
- [Source documents](docs/references/README.md)

Live analysis and AI-assisted evaluation use configured provider credentials. Deterministic evaluation, human review, and reports also work with the curated demo.
