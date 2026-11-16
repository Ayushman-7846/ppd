# LinguaLens user manual

1. Open **My workspace** and register or sign in. The dashboard defaults to live research. The guest demo and curated trial population carry separate provenance labels.
2. Use **Dataset Studio** to preview teaching cases, duplicate a collection, or import JSON or CSV. Edit a collection to create a new version. **Prompt Studio** saves new versions and previews the exact prompt.
3. In **Settings → AI Model Configuration**, select a provider, add an authorized account key when storage is enabled, and save a default model identifier. **Test connection** checks the model catalog. The last successful check, latest status, latency and errors appear under **Provider diagnostics**. Conduct an actual trial to verify generation.
4. Use the four **Linguistic analyses** pages for a single item. Inspect the exact prompt, metadata, validation and raw response. Use keyboard arrows or a pointer to pan a syntax tree, and use the toolbar for zoom, fullscreen, and export.
5. In **Experiment Laboratory**, select datasets, models, prompts and repeats. Review the manifest, start, and wait for stored trials. Use history to inspect or retry failures.
6. In **Evaluation Center**, choose a saved rubric or create a new weighted version. Select eligible trial pages, queue deterministic or judge evaluation, then inspect attempt evidence. Authorized reviewers open **Human review → Assigned to me**, save drafts, and submit. Administrators use **Disagreements** for adjudication.
7. In **Model Comparison**, **Consistency Laboratory**, **Research Analytics**, or **Model Leaderboard**, select a source, rubric and method before calculating. Check ranking eligibility, coverage, intervals and exact denominators.
8. In **Reports**, choose a settled experiment and matching cohort filters, generate a snapshot and download PDF, CSV or JSON. Prefer JSON when reproducing the full frozen evidence.

Use role management from a trusted backend console. `python -m app.reviewer_roles reviewer@example.com reviewer` grants the reviewer role after account registration. Use the `admin` role for a designated adjudicator. [Deployment and configuration](deployment-guide.md) · [Faculty walkthrough](final-demo-guide.md)
