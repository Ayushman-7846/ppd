# Deployment guide

## Local development on Windows

Use Node.js 20.9 or newer and Python 3.13 for the verified setup. The default database is SQLite. Keep the API and website origins consistent.

```powershell
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start the frontend from a separate shell.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

For a production build outside Docker, set `BACKEND_URL` for the Next.js rewrite **before** building, then run `npm run build` and `npm run start`. Use an existing PostgreSQL database by setting `DATABASE_URL` to a psycopg DSN. Use SQLite for local development and PostgreSQL for deployment. Check `GET /health/live` and `GET /health/ready` on the internal API.

## Container startup

Copy `.env.example` to `.env` and generate a unique URL-safe `POSTGRES_PASSWORD`. The Compose stack waits for PostgreSQL, runs migration in a one-shot service, checks the API and starts a non-root Next.js standalone process. It stores research data in the `db-data` volume.

```powershell
docker compose config --quiet
docker compose up --build --wait
docker compose ps --all
docker compose logs migrate backend frontend
Invoke-RestMethod http://localhost:8000/health/ready
Invoke-RestMethod http://localhost:3000/api/v1/demo/overview
docker compose exec backend alembic check
```

Confirm the migration service exited successfully. Sign in on the website, open Dataset Studio, run the showcase preset and generate a report. The frontend loopback health check follows the API rewrite. For browser integration with Compose, point the Playwright suite at a disposable, migrated instance. Reviewer privileges can be set through `docker compose exec backend python -m app.reviewer_roles <test-email> reviewer`.

## Environment and HTTPS

| Setting | Purpose |
| --- | --- |
| `WEB_ORIGIN` | Exact HTTPS browser origin for application mutations. Match the URL visitors use. |
| `SECURE_COOKIE` | Set to `true` after HTTPS is active. LAN demonstrations over plain HTTP use `false` only on a trusted network. |
| `REGISTRATION_ENABLED` | Register the initial tester/reviewer accounts and then set to `false` for an invite-only deployment. |
| `ALLOW_SHARED_PROVIDER_KEYS` | Compose defaults to `false`. Enable only in a restricted workspace whose authenticated researchers can spend the shared provider budget. |
| `CREDENTIAL_KEY` | Fernet key for encrypting account-managed provider keys. Keep it in the secret store and retain the original when restoring encrypted records. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | Optional backend-only credentials for permitted shared use. |
| `WORKER_ENABLED` | Enable it on a supervised process. At least one worker must run for trials to settle. |
| `OLLAMA_HOST`, `SEMANTIC_MODEL` | Private Ollama endpoint and installed model ID for explicit embedding comparisons. |

Expose only the website behind a TLS reverse proxy. Keep PostgreSQL, FastAPI and Ollama on private interfaces. Configure ingress rate limits for auth and provider activity and use upstream provider project quotas. Compose loopback ports support local testing. The built-in peer quota sees the reverse proxy peer when the API is proxied. Keep request logs free of request bodies, keys, cookies and raw experimental output. Route auth events and audit logs to an appropriate retention policy. Set HTTPS redirect and HSTS at the ingress after verifying TLS. Review headers and resource policy against the actual hosting origin.

## Bounded live checks

Save a provider model in **Settings → AI Model Configuration** and run **Test connection**. Catalog reachability measures discovery. Use an actual saved trial to verify generation. Use a test account whose provider project has an appropriate spending limit.

```powershell
backend/.venv/Scripts/python.exe scripts/live_provider_check.py --email researcher@example.com --provider openai --model YOUR_CONFIGURED_MODEL
backend/.venv/Scripts/python.exe scripts/live_provider_check.py --email researcher@example.com --provider openai --model YOUR_CONFIGURED_MODEL --execute
```

The second command queues one item in each of the four analyzers. Pass `--judge-provider` and `--judge-model` for one judge attempt after a successful live response. Existing provider retries can repeat a request. The script prompts for the workspace password and prints IDs, result state, usage metadata and timing. Provider keys stay in Settings or server configuration.

For semantic similarity, install Ollama on the trusted host and pull a chosen **embedding-capable** model. Set `OLLAMA_HOST` to its private origin and `SEMANTIC_MODEL` to the exact installed name. Restart the API, open a matched consistency group with two to five saved texts, and request similarity. Check the saved model ID, vector dimension, pair count and matrix. If the service fails, verify its version, installed model catalog, and reachability from the backend host or container.

## Backup, restore and rollback

Before upgrading, stop submissions, allow active trials to settle, and back up PostgreSQL plus the exact release/configuration. Keep the encryption key in an independent secured backup. Test a restore into a distinct database.

```powershell
docker compose exec -T db pg_dump -U lingualens -d lingualens -Fc -f /tmp/lingualens.dump
docker compose cp db:/tmp/lingualens.dump ./lingualens.dump
docker compose cp ./lingualens.dump db:/tmp/lingualens-restore.dump
docker compose exec -T db createdb -U lingualens lingualens_restore_check
docker compose exec -T db pg_restore -U lingualens -d lingualens_restore_check /tmp/lingualens-restore.dump
```

Point a staging API at the restored database, run readiness, confirm the expected revision, and sample experiments and exports. For rollback, prefer a previous release against a validated backup or explicitly compatible schema. Review downgrade conditions before applying them. Revision `0005` downgrade removes diagnostic and auth-quota history. Revision `0004` can refuse downgrade if multiple versions of the same review now exist. Preserve the volume when stopping Compose.

| Symptom | Check |
| --- | --- |
| API readiness fails | Database connection, one-shot migration logs, and expected revision. |
| Registration or save is rejected | Exact `WEB_ORIGIN`, HTTPS/cookie setting, registration policy, and whether the auth window is throttled. |
| Browser API proxy is wrong | `BACKEND_URL` at build time. Rebuild when changing it. |
| Pending jobs remain | `WORKER_ENABLED`, API logs, and the provider state. Inspect saved status before resubmitting. |
| Catalog works but run fails | Model access, selected API capabilities, supported parameters, quota and completion/structure metadata. |

[Compose dependency conditions](https://docs.docker.com/compose/how-tos/startup-order/) · [Final verification status](final-testing-report.md)
