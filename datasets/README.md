# Datasets

`demo.json` contains LinguaLens-authored examples, synthetic aggregate scores, and fictional model identities for interface demonstrations. It is the shared fixture for both the browser and the demo API.

Each `phase2-*.json` file contains ten original teaching items for the named task. Items include a stable key, typed stimulus, reference fields, and a curated demo answer. The live adapters receive the stimulus and prompt schema. Curated answers are used only when the demo model is selected.

For the original study’s materials, see the [authors’ OSF deposit](https://osf.io/y3bpt). When importing benchmark items in Phase 2, record the source and license for each dataset version and keep replication items distinct from unpublished held-out items.
