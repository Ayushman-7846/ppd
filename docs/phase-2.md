# Phase 2 research workflow

## Configure a model

1. Start the API and frontend as described in the [setup guide](../README.md).
2. Register or sign in from **My workspace**.
3. Open **Settings → AI Model Configuration** and select a provider. Add a server environment credential or enter an encrypted account credential. Enable the provider and save.
4. Select **Test connection**. Choose a returned model, or enter the model identifier if your provider account requires a specific model. Save it as the default. The connection test queries the model catalog and sends no analysis prompt.
5. Select the default model or enter a different model identifier in an analyzer or experiment. Set per-run parameters there. Saved defaults apply only to the configured default model.
6. For a credential-free demonstration, select **LinguaLens reference · Demo** and use a curated item. Demo results reproduce authored annotations and are labelled in the controls, trial, and result.

| Provider | Adapter | Backend configuration |
| --- | --- | --- |
| OpenAI | Official Python SDK and Responses API | `OPENAI_API_KEY` or encrypted account key |
| Google Gemini | Google Gen AI SDK and Generate Content API | `GEMINI_API_KEY` or encrypted account key |
| Anthropic Claude | Official Python SDK and Messages API | `ANTHROPIC_API_KEY` or encrypted account key |
| OpenRouter | Official OpenAI SDK against the OpenRouter-compatible API | `OPENROUTER_API_KEY` or encrypted account key |
| Ollama | Official Python SDK, server installed model catalog and Chat API | `OLLAMA_HOST`, a server-controlled address |

For Docker development set the variables in the project root `.env`. For a direct API run set them in `backend/.env` or the backend process environment. Environment credentials are shared with authenticated researchers on that instance. Set `CREDENTIAL_KEY` in the same location to enable account-specific encrypted keys. Generate one in the backend virtual environment with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Keep the encryption key separate from credentials and back it up with the deployment. Replacing it requires re-entering saved account keys.

Ollama requires a reachable Ollama service and at least one installed text model. The direct backend defaults to `http://127.0.0.1:11434`. Compose defaults to `http://host.docker.internal:11434`. Custom model hosts and credentials are server-side configuration. Sampling controls vary by provider and model. The adapters translate supported parameters and return a safe rejection if a provider declines a configuration.

Provider API references are maintained by each service. [OpenAI Responses](https://platform.openai.com/docs/api-reference/responses/create) · [Gemini text generation](https://ai.google.dev/gemini-api/docs/text-generation) · [Anthropic Messages](https://platform.claude.com/docs/en/api/messages) · [OpenRouter quickstart](https://openrouter.ai/docs/quickstart) · [Ollama Chat](https://docs.ollama.com/api/chat)

## Faculty demonstration

1. Sign in and open **Ambiguity Analysis**. Select *I saw the astronomer with the telescope*, choose the demo model, and analyze. Switch between VP and NP attachment, compare both trees, select a node to highlight its branch, and export a tree. Open the saved response, inspect the exact prompt and reference fields, then re-run it.
2. Open **Recursion Analysis** and choose a possessive or center-embedded example. Compare the original and expanded structures. Move the visible-level slider and locate the highlighted added layer. Explain that the displayed depth is a model estimate in live mode.
3. Open **Syntactic Movement** and choose *Which map did Lena redraw?*. Select **Trace 1** to highlight the trace and landing position and inspect the movement dependency.
4. Open **Phonological Analysis** and use the first demo item. Inspect occurrences of each phone in underlying and surface forms, compare the evidence rows, and enter `f ə b` in the rule tester. The word-final substitution predicts `f ə p`. The verification badge refers to the supplied paired examples.
5. Open **Dataset Studio** and preview the relevant teaching collection. Export a JSON or CSV template. Import it under a new name or enter your own stimuli and optional references. Syntax CSV uses `item_key,sentence` with optional `category,reference`. Phonology CSV uses `item_key,word_id,surface` with optional `underlying,target,context,phones_of_interest,reference`. Each phonology item groups rows sharing the same item key. References in CSV are JSON objects. JSON is the lossless exchange format.
6. In **Prompt Studio**, create a new version, preview the exact rendered prompt and task schema, and test the saved version on a teaching stimulus. The demo returns its same curated annotation when you edit a prompt. With a configured live provider, a prompt test sends the saved template to the selected model.
7. In **Experiment Laboratory**, select two teaching datasets, the demo model, and two repetitions. Review the manifest, start the experiment, inspect per-model and per-item progress, and open a saved trial. When live models are configured, add another model to run the same items on both. Failure and cancellation preserve completed trials, and eligible failed trials can be retried.

## Research interpretation

The original study used standardized task prompts, X-bar-oriented tree outputs, and human grading. Phase 2 adds bounded JSON tree data, indexed movement overlays, optional paired phonology forms, versioned configurations, and repeatable experiment manifests. The hosted provider returns observable text and structured outputs. The platform records whether JSON and structure pass, whether selected reference fields match, and whether a supported substitution reproduces its observed examples. Overall linguistic correctness stays unreviewed pending evaluation. [IEEE publication](https://doi.org/10.1109/TAI.2025.3575745) · [Authors’ manuscript](https://arxiv.org/abs/2305.00948)

Demo data consists of ten LinguaLens-authored illustrations per task. The ambiguity teaching set focuses on PP attachment. The phonology rule tester implements single-phone replacements with optional literal neighbors or word boundaries. Natural classes, insertion, deletion, and broader rule systems remain inspectable explanations, with no deterministic verification badge for those rules. Unknown demo inputs return an explicit error. The Phase 1 landing comparison still shows synthetic interface data.

The database worker supports lease recovery, bounded retries, and cancellation between provider attempts. A remote request already in flight can finish after cancellation. Recovery after an interrupted provider call can resend that trial, so requests have at-least-once delivery. Remote model output may vary across equivalent runs. Deleting a dataset archives its active catalog version and deleting a response removes it from researcher views while preserving referenced trial data. These records remain available for reproducibility and storage administration.

## Browser verification

For a clean test, use an isolated API database and start both servers. From `frontend/`, run `npx playwright install chromium` once, then `npm run test:browser`. Set `RESEARCH_BROWSER_CHANNEL=msedge` to use installed Edge. Set `RESEARCH_BASE_URL` if the web origin differs, and match the API’s `WEB_ORIGIN`. The script creates a test researcher, imports sample data, and saves trials. `RESEARCH_SCREENSHOTS_DIR` optionally captures analyzer and experiment panels.

The automated API suite exercises all five SDK adapters against simulated HTTP responses. An external credentialed smoke test requires an account key or an Ollama server with an installed model. Use **Test connection** and submit one curated item before configuring a live batch.

## Phase 3 handoff

The `evaluations` table and stored response IDs, prompt versions, reference annotations, and validation evidence support task-specific scoring and reviewer assignment. Phase 3 should add immutable rubrics, blinded review and adjudication, trial consistency and agreement metrics, and research reports with sample sizes and uncertainty. The Phase 2 labels distinguish reference field matches and deterministic checks from independent evaluations.

## File inventory

| Area | New files | Updated files |
| --- | --- | --- |
| API | `backend/app/catalog.py`, `catalog_api.py`, `lab_schemas.py`, `linguistics.py`, `providers.py`, `queue.py`, `request_limit.py`, `run_api.py` | `backend/app/config.py`, `main.py`, `models.py` |
| Schema and fixtures | `backend/migrations/versions/0002_add_durable_research_execution.py` and the four `datasets/phase2-*.json` fixtures | `datasets/README.md` |
| Frontend | `frontend/app/research.css`, `frontend/lib/research-api.ts`, `frontend/components/analysis-history.tsx`, `dataset-studio.tsx`, `experiment-workspace.tsx`, `phone-input.tsx`, `prompt-studio.tsx`, `provider-settings.tsx`, `research-access.tsx`, `research-analyzer.tsx`, `research-controls.tsx`, `research-poll.ts`, `research-result.tsx`, `tree-viewer.tsx` | `frontend/app/layout.tsx`, `app/lab/[module]/page.tsx`, `components/lab-settings.tsx`, `components/lab-tools.tsx`, `components/private-workspace.tsx`, `lib/api.ts`, `lib/modules.ts` |
| Verification and setup | `backend/tests/test_research.py`, `backend/tests/test_provider_adapters.py`, `frontend/tests/research.browser.mjs`, `docs/phase-2.md` | `README.md`, `docs/architecture.md`, `docs/research.md`, `docs/roadmap.md`, `.env.example`, `backend/.env.example`, `docker-compose.yml`, `backend/requirements*.txt`, `frontend/package*.json` |
