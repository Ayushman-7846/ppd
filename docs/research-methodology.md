# Research methodology

## Scientific basis

Beguš, Dąbkowski, and Rhodes constructed 120 items and elicited 480 outputs across four models. They used standard task templates and independent binary human grading of subtasks. The paper reports majority-vote descriptive outcomes and mixed-effects logistic inference. LinguaLens adapts the four tasks to structured JSON and adds rubric versions, retained retries, repeatability, optional judges, matched comparisons and percentile intervals. Results from a LinguaLens cohort have their own sampling and protocol. [Published study](https://doi.org/10.1109/TAI.2025.3575745) · [Manuscript](https://arxiv.org/abs/2305.00948) · [Protocol analysis](research.md)

| Task | Evidence a reviewer should inspect |
| --- | --- |
| Ambiguity | Detection, distinct readings, structural attachment, tree topology, and reference mismatches. Wording differences can need expert review. |
| Recursion | Presence and category of embedding, span and hierarchy, and one grammatical new layer. Depth has a recorded convention or remains qualitative. |
| Movement | Moved constituent, origin, landing position and co-indexing of a lower trace with its destination under the target construction. |
| Phonology | Input and output phones, conditioning environment, effect on controls and held-out forms, and the stated exceptions. Formal checking supports literal single-phone substitutions with immediate contexts. |

## Data and protocol

Built-in teaching datasets are authored fixtures. The separate [pilot manifest](../datasets/benchmark-v1/manifest.json) has 16 new items with two positive and two negative targets in each dimension. Each importable file has references, provenance and a named version. The manifest provides item difficulty and review status. All annotations are candidates awaiting independent review. Difficulty is an annotation priority, with empirical difficulty measured only after collection. No external corpus was copied.

Before a research run, use two independent linguistics reviewers, confirm the intended construction and acceptable alternative analyses, and resolve disagreement in a versioned annotation log. Review the phonology controls and hold-out rows before inference. Freeze the dataset and prompt, record provider model identity and effective settings, and disclose failure and missing-score denominators. The benchmark pilot includes underlying/surface pairs for controlled checking. The paper used surface-form induction for its phonology task.

## Scoring and inference

An exact check assesses the observable field or supported formal rule. Structural validity assesses bounded representation separately from linguistic correctness. Weighted totals require every positively weighted criterion to be graded. Judge outputs are structured evidence from a separate configured model. Human reviews have independent drafts, optional metadata blinding, and exact-review-set adjudication. Provider request failures are reported separately from decisive incorrect verdicts.

Comparisons use matching items, dataset and prompt versions, exact prompts, parameter and repetition settings, scorer configuration, and reported model identity. Repeat agreement has separate eligible-pair denominators for classification, canonical structure, exact text and decisive verdict. Optional embedding cosine is a representational similarity measurement. Paired estimates collapse trials within stimuli. The percentile interval uses 1,200 seeded resamples when at least eight stimulus summaries vary. [Metric definitions and checks](phase-3.md)
