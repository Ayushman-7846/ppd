# LinguaLens project overview

LinguaLens is a website for measuring how large language models analyze syntactic and phonological structures. The engineering problem is to collect comparable evidence across models whose text, schemas, versions and availability differ. A complete analysis can include a category, a parse or trace, a phonological rule and an explanation.

## Objectives and scope

- Execute standardized, versioned prompts across four metalinguistic tasks.
- Preserve exact prompts, parameters, and output before linguistic validation.
- Keep deterministic evidence, AI-assisted grades, human grades and adjudication traceable.
- Compare aligned cohorts, measure repeatability, and export evidence with provenance.
- Support a credential-free faculty demonstration, plus bounded live runs when a provider is configured.

The supplied Product Development II abstract names weighted correctness, analysis, explanation and repeated-response consistency as project objectives. The implementation treats trial consistency as a separate measurement and gives each scoring method its own provenance. Personal identifiers in the abstract are kept out of the public repository. [Source documents](references/README.md)

## Technology and applications

The frontend uses Next.js App Router, React, TypeScript, and Recharts. FastAPI, Pydantic, SQLAlchemy and Alembic implement the API and persistence. PostgreSQL supports the deployment configuration and SQLite supports local development. ReportLab renders PDFs. Hosted SDKs and Ollama supply optional inference.

Linguistics instructors can use the tree and rule interfaces to compare analyses. Researchers can design controlled experiments and inspect annotation agreement. Model engineering teams can evaluate structural behavior and investigate common errors. The measured outcomes concern responses observed in those protocols. [Research methodology](research-methodology.md)
