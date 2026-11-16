# Research basis

LinguaLens studies how well a language model can produce a formal analysis of language data. A fluent sentence or a correct yes/no judgment tells us less than a response that also explains the relevant structure, produces a valid tree, or gives a rule that generalizes. The application treats these outputs as observable evidence of task performance.

## Primary study

Gašper Beguš, Maksymilian Dąbkowski, and Ryan Rhodes. 2025. *Large Linguistic Models: Investigating LLMs’ Metalinguistic Abilities*. IEEE Transactions on Artificial Intelligence 6(12), 3453–3467. [IEEE publication](https://doi.org/10.1109/TAI.2025.3575745) · [Prompts, dataset, grading manual, and outputs](https://osf.io/y3bpt)

Sections III–IV define the research program and protocol. The authors constructed 30 new items per task, for 120 items total. The syntax set contained 90 English sentences and the phonology set contained 30 toy languages with 40 invented surface forms per item. One prompt template per task was instantiated with each item. GPT-3.5 Turbo (gpt-3.5-turbo-0125), GPT-4 (gpt-4-0314), Llama 3.1 (meta.llama3-1-405b-instruct-v1), and o1 (o1-preview-2024-09-12) produced 480 outputs at reported default temperatures (0.5 for Llama and 1.0 for the OpenAI models).

| Task | Input and expected output | Graded subtasks |
| --- | --- | --- |
| Ambiguity (§V-A) | An English sentence with structural ambiguity. Identify ambiguity and produce distinct X-bar parses in LaTeX Forest. | Detection, structurally correct trees |
| Recursion (§V-B) | An English sentence with nested structures. Identify the recursive span and type, show the nesting in an X-bar tree, and add one layer of the same type. Includes adjectival, possessive, PP and clausal cases, including center embedding. | Detection, type, tree, valid extension |
| Movement (§V-C) | An English sentence with a target construction such as raising, inversion or wh-movement. Produce an X-bar tree showing indexed traces at origin positions. The prompts omitted movement arrows after pilot rendering failures. | Representation of the target movement |
| Phonology (§V-D) | Spaced phone strings and phones of interest from an invented language. Infer a rule A → B / environment, using natural classes wherever possible. | Rule input, output, and conditioning environment |

Three graduate linguistics graders independently rated each subtask correct or incorrect, ignoring errors outside that subtask. This yielded 3,600 judgments. Figure 1 uses majority vote for descriptive scores. Section VI uses individual grades in logistic mixed-effects models with item and annotator effects, excluding ambiguity and recursion detection because scores were near ceiling. The movement model dropped its per-item model slope for convergence. The distinction matters when interpreting confidence intervals and adjusted pairwise comparisons.

## Findings and limitations

- On these items, o1 had majority-vote scores of 0.63 on ambiguity trees, 0.87 on recursion trees and 0.93 on movement trees. It correctly inferred 19 of 30 phonological environments, reported as 0.63. These are results for the tested model snapshots and subtasks (Fig. 1).
- Simple detection was generally high across models. o1 missed recursion in three items whereas the other models identified all 30 (§VII, note 15). All ambiguity-detection items were positive. A balanced extension is needed to measure false positives.
- The 30 items in each task span many subcategories, with too few per category for subgroup claims. Published items can enter future training data. Fresh held-out items, including artificial grammars, help assess generalization.
- Section III recommends repeated or similar prompts because outputs vary. The 480-output experiment used one response per item and model. It reports annotator agreement through majority aggregation, which addresses a different question from stability across model trials.
- A formatting error can prevent a tree from rendering even when its structure is interpretable. Some printed examples received minor repair and abridgement. Preserve the original output, parse validity, and grading evidence separately.
- The evidence concerns elicited behavior. The authors propose a chain-of-thought explanation for o1’s advantage. The study does not establish that mechanism by causal intervention.

## Project abstract and extensions

The supplied abstract is titled *LinguaLens: An Intelligent Framework for Evaluating Metalinguistic Abilities in Large Language Models*, under Product Development II. It calls for standardized prompting, a structured test dataset, multi-model comparison, a dashboard, and evaluation of correctness, quality of analysis, explanation quality, and consistency across repeated evaluations. The IEEE paper supplies the experimental reference and its binary rubric. The abstract supplies the product objectives and adds evaluation dimensions, leaving the scoring scales and aggregation unspecified.

For a replication track, keep the binary subtask rubric, adjudication rule, model snapshots and prompt templates explicit. For an extension track, record provider parameters, prompt and dataset versions, repeated trials and refusals. Compute correctness with a scored denominator and report missing responses. Define consistency as within-item agreement on structured answers across trials and report it alongside correctness since a model can repeatedly give the same wrong answer. Use format checks as automated evidence, then compare expert judgments for linguistic correctness and explanation quality. Store multiple acceptable parses and support blind review and disagreement resolution. Preserve original outputs while rendering validated trees from bounded structured data.

Project contributions include an auditable run manifest, repeatability analysis, aligned model comparisons, a syntax-tree viewer, and editable but versioned datasets and prompt protocols. These are product contributions with respect to the supplied paper. Applications include model evaluation for NLP teams, methods instruction and error analysis in linguistics courses, and comparative research on how models handle structural constraints.

The originals are indexed in [references](references/README.md). Demo fixtures are original illustrations with synthetic model names and scores and are excluded from research findings.

Phase 2 implements these four tasks with bounded JSON schemas and versioned instructions. It records the raw reply before interpreting a tree or rule, distinguishes structural validity from scored judgments, and checks observable outputs against selected reference fields. The authored demonstration sets contain ten items per dimension. They include paired underlying and surface forms for a deterministic phonology demonstration, an extension to the paper’s surface-form induction task. [Phase 2 research workflow](phase-2.md)
