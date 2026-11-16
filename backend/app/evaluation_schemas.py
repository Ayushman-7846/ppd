from math import isclose
from typing import Annotated, Literal

from pydantic import EmailStr, Field, StringConstraints, field_validator, model_validator

from .lab_schemas import InputModel, Name, Selection


Criterion = Literal["correctness", "analysis_quality", "explanation_quality", "structural_validity", "completeness"]
Verdict = Literal["correct", "incorrect", "uncertain"]
Method = Literal["deterministic", "judge", "human", "consensus"]
Score = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
Id = Annotated[int, Field(gt=0)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1800)]
DEFAULT_WEIGHTS = {"correctness": 40, "analysis_quality": 20, "explanation_quality": 15, "structural_validity": 15, "completeness": 10}
DEFAULT_CRITERIA = {
    "correctness": "Check the task conclusion and linguistic details against references and the stimulus.",
    "analysis_quality": "Assess whether the formal analysis explains the relevant facts and dependencies.",
    "explanation_quality": "Assess clarity, supporting evidence, and links between evidence and conclusions.",
    "structural_validity": "Assess whether the tree, rule, or dependency representation meets structural constraints.",
    "completeness": "Check coverage of the requested subtasks and required supporting information.",
}
ERRORS = {
    "general": ["malformed_response", "missing_information", "incomplete_explanation", "unsupported_claim"],
    "ambiguity": ["ambiguity_detection", "missing_interpretation", "duplicate_interpretation", "incorrect_attachment", "invalid_tree"],
    "recursion": ["recursion_detection", "recursion_type", "incorrect_depth", "recursive_span", "invalid_expansion", "incorrect_hierarchy", "invalid_tree"],
    "movement": ["movement_classification", "wrong_constituent", "wrong_origin", "wrong_landing", "trace_mismatch", "invalid_tree"],
    "phonology": ["input_phoneme", "output_phoneme", "conditioning_environment", "overgeneralization", "undergeneralization", "unsupported_rule", "unseen_example_mismatch"],
}


class RubricDraft(InputModel):
    name: Name
    weights: dict[Criterion, Score]
    criteria: dict[Criterion, Note] = Field(default_factory=lambda: DEFAULT_CRITERIA.copy())

    @model_validator(mode="after")
    def complete_weights(self):
        if self.weights.keys() != DEFAULT_WEIGHTS.keys() or not isclose(sum(self.weights.values()), 100, abs_tol=1e-8, rel_tol=0):
            raise ValueError("Supply all five criterion weights totaling 100%.")
        if self.criteria.keys() != DEFAULT_WEIGHTS.keys():
            raise ValueError("Supply a description for each criterion.")
        return self


class RubricView(RubricDraft):
    id: int
    version: int


class AssessmentRequest(InputModel):
    response_ids: list[Id] = Field(min_length=1, max_length=80)
    rubric_id: Id
    method: Literal["deterministic", "judge"]
    judge: Selection | None = None

    @model_validator(mode="after")
    def mode(self):
        if len(set(self.response_ids)) != len(self.response_ids):
            raise ValueError("Choose each response once.")
        if (self.method == "judge") != (self.judge is not None):
            raise ValueError("Choose a separate live judge for AI-assisted evaluation.")
        if self.judge and self.judge.provider == "demo":
            raise ValueError("Choose a live model for judging.")
        return self


class Annotation(InputModel):
    category: Annotated[str, StringConstraints(max_length=64)]
    severity: Literal["minor", "major", "critical"]
    evidence: Note


class AssignmentRequest(InputModel):
    response_id: Id
    rubric_id: Id
    reviewer: EmailStr
    blind: bool = True


class ReviewInput(InputModel):
    revision: int = Field(ge=0)
    scores: dict[Criterion, Score] = Field(default_factory=dict)
    verdict: Verdict | None = None
    comment: Annotated[str, StringConstraints(max_length=1800)] = ""
    errors: list[Annotation] = Field(default_factory=list, max_length=20)
    submit: bool = False


class Adjudication(InputModel):
    response_id: Id
    rubric_id: Id
    verdict: Verdict
    justification: Note
    review_ids: list[Id] | None = Field(None, min_length=2, max_length=1000)


class ErrorResolution(InputModel):
    state: Literal["confirmed", "dismissed"]


class JudgeCriterion(InputModel):
    score: Score | None
    evidence: Note


class JudgeAnswer(InputModel):
    criteria: dict[Criterion, JudgeCriterion]
    verdict: Verdict
    justification: Note
    errors: list[Annotation] = Field(max_length=20)
    assessment: Note
    confidence: Literal["low", "medium", "high"]

    @field_validator("criteria")
    @classmethod
    def all_criteria(cls, value):
        if value.keys() != DEFAULT_WEIGHTS.keys():
            raise ValueError("Return evidence and a score or null for each criterion.")
        return value
