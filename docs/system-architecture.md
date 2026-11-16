# System architecture

The browser uses one public website origin. Next.js rewrites API paths to FastAPI. The API checks the session, ownership, and mutation origin. The existing worker claims queued rows with a lease and commits provider results only when its claim still matches.

```mermaid
flowchart LR
  Browser["Browser and interactive SVG viewer"] --> Next["Next.js website"]
  Next -->|"Same-origin API proxy"| API["FastAPI API"]
  API --> Store[("PostgreSQL or local SQLite")]
  Worker["Trial and evaluation worker"] -->|"Claim and settle"| Store
  Worker --> Hosted["Configured hosted LLM or Ollama"]
  API --> Judge["Human review and adjudication"]
  Judge --> Store
  API --> Analysis["Matched comparison and consistency"]
  Analysis --> Store
  Analysis -.-> Embed["Optional Ollama embeddings"]
  API --> Render["Frozen reports and ReportLab"]
  Render --> Store
```

```mermaid
sequenceDiagram
  actor R as Researcher
  participant A as API
  participant D as Database
  participant W as Worker
  participant P as Provider
  R->>A: Submit versioned experiment
  A->>D: Insert manifest and pending trials
  W->>D: Claim a pending response
  W->>P: Send saved prompt and settings
  P-->>W: Output, usage and model metadata
  W->>D: Retain raw text, validation and execution state
  R->>A: Queue rubric evaluation or assign human reviews
  A->>D: Save versioned assessment and review evidence
  R->>A: Calculate a matched cohort and export
  A->>D: Store frozen report specification
```

The frontend renders stored structured outputs as bounded interactive SVG and renders model text as text. The registry preserves exact model IDs. Report exports use an owner-scoped frozen specification and make CSV, JSON, and PDF from that record. Provider diagnostics store the latest catalog result and last successful lookup without persisting credentials in diagnostic rows. [Detailed schemas and API routes](architecture.md)
