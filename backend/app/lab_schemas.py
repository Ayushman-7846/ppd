from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, field_serializer, model_validator

from .schemas import Dimension


Provider = Literal["openai", "gemini", "anthropic", "openrouter", "ollama"]
ProviderChoice = Literal["demo", "openai", "gemini", "anthropic", "openrouter", "ollama"]
DIMENSIONS = ("ambiguity", "recursion", "movement", "phonology")
CATEGORIES = {
    "recursion": ("adjectival", "possessive", "prepositional", "clausal", "center embedding"),
    "movement": ("wh-movement", "auxiliary inversion", "passive", "topicalization", "relative clause", "raising"),
}
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
Key = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1800)]
Token = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24, pattern=r"^[^\s<>]+$")]
ModelId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9./:_@-]*$")]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PhoneRow(InputModel):
    word_id: Key
    underlying: Text | None = None
    surface: Text
    target: Token | None = None
    context: Annotated[str, StringConstraints(max_length=240)] = ""

    @model_validator(mode="after")
    def bound_phones(self):
        if any(len(value.split()) > 80 or any(len(phone) > 24 for phone in value.split())
               for value in (self.underlying or "", self.surface)):
            raise ValueError("Each form may contain at most 80 space-separated phones.")
        return self


class Stimulus(InputModel):
    sentence: Text | None = None
    category: Annotated[str, StringConstraints(max_length=40)] | None = None
    rows: list[PhoneRow] = Field(default_factory=list, max_length=60)
    phones_of_interest: list[Token] = Field(default_factory=list, max_length=32)

    def check_task(self, dimension: Dimension):
        if dimension == "phonology":
            if self.sentence or self.category or not self.rows:
                raise ValueError("Provide phonological rows and omit sentence and category.")
            if len({row.word_id.casefold() for row in self.rows}) != len(self.rows):
                raise ValueError("Word identifiers must be unique within an item.")
        else:
            if not self.sentence or self.rows or self.phones_of_interest:
                raise ValueError("Provide a sentence for this task.")
            if self.category and self.category not in CATEGORIES.get(dimension, ()):
                raise ValueError("The selected category is unavailable for this task.")


class Reference(InputModel):
    annotation: Text | None = None
    detected: bool | None = None
    category: Annotated[str, StringConstraints(max_length=64)] | None = None
    interpretation_count: int | None = Field(None, ge=1, le=8)
    rule_input: Text | None = None
    rule_output: Text | None = None
    environment: Text | None = None
    interpretation_meanings: list[Text] = Field(default_factory=list, max_length=8)
    attachments: list[Text] = Field(default_factory=list, max_length=8)
    recursive_segment: Text | None = None
    recursive_depth: int | None = Field(None, ge=1, le=24)
    expansion: Text | None = None
    constituent: Text | None = None
    origin: Text | None = None
    landing: Text | None = None
    held_out: list[PhoneRow] = Field(default_factory=list, max_length=24)


class ItemInput(InputModel):
    item_key: Key
    stimulus: Stimulus
    reference: Reference = Field(default_factory=Reference)


class DatasetInput(InputModel):
    name: Name
    dimension: Dimension
    provenance: Text = "Researcher supplied"
    items: list[ItemInput] = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_items(self):
        keys, stimuli = set(), set()
        for item in self.items:
            item.stimulus.check_task(self.dimension)
            if self.dimension == "phonology":
                content = tuple(sorted((row.underlying or "", row.surface, row.target or "") for row in item.stimulus.rows))
            else:
                content = " ".join(item.stimulus.sentence.casefold().split())
            key = item.item_key.casefold()
            if key in keys or content in stimuli:
                raise ValueError(f"Duplicate item in dataset: {item.item_key}")
            stimuli.add(content)
            keys.add(key)
        return self


class DatasetSummary(BaseModel):
    id: int | str
    name: str
    dimension: Dimension
    version: int
    provenance: str
    kind: Literal["user", "builtin"]
    item_count: int


class DatasetDetail(DatasetSummary):
    items: list[ItemInput]


class Parameters(InputModel):
    temperature: float | None = Field(None, ge=0, le=2)
    max_output_tokens: int | None = Field(None, ge=128, le=8192)
    top_p: float | None = Field(None, gt=0, le=1)
    timeout: float | None = Field(None, ge=2, le=90)


class ProviderUpdate(InputModel):
    enabled: bool
    credential: SecretStr | None = None
    clear_credential: bool = False
    default_model: ModelId | None = None
    parameters: Parameters = Field(default_factory=Parameters)

    @model_validator(mode="after")
    def validate_credential(self):
        if self.credential is not None:
            value = self.credential.get_secret_value()
            if len(value) > 4096 or not value.strip() or self.clear_credential:
                raise ValueError("Supply a valid credential or request removal.")
        return self


class ProviderCheck(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    checked_at: datetime
    last_success_at: datetime | None
    latency_ms: int
    status: Literal["reachable", "failed", "blocked"]
    model: str | None
    model_count: int | None
    model_listed: bool | None
    error_code: str | None
    error_message: str | None

    @field_serializer("checked_at", "last_success_at")
    def utc_timestamp(self, value):
        if value is None:
            return None
        return (value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


class ProviderInfo(BaseModel):
    provider: Provider
    enabled: bool
    configured: bool
    credential_source: Literal["account", "environment", "server", "none"]
    accepts_credential: bool
    credential_storage: bool
    default_model: str | None
    parameters: Parameters
    capabilities: list[str] = Field(default_factory=list)
    diagnostic: ProviderCheck | None = None


class Selection(InputModel):
    provider: ProviderChoice = "demo"
    model: ModelId | None = None
    parameters: Parameters = Field(default_factory=Parameters)


class ModelOption(BaseModel):
    provider: ProviderChoice
    model: str
    label: str


class AnalysisInput(InputModel):
    selection: Selection = Field(default_factory=Selection)
    stimulus: Stimulus | None = None
    dataset_id: int | str | None = None
    item_key: Key | None = None
    prompt_id: int | None = Field(None, ge=1)

    @model_validator(mode="after")
    def one_source(self):
        if self.stimulus is not None:
            if self.dataset_id is not None or self.item_key is not None:
                raise ValueError("Submit either a custom input or a dataset item.")
        elif self.dataset_id is None or self.item_key is None:
            raise ValueError("Select a dataset item or enter custom input.")
        return self


class ExperimentInput(InputModel):
    name: Name
    dataset_ids: list[int | str] = Field(min_length=1, max_length=4)
    selections: list[Selection] = Field(min_length=1, max_length=6)
    repetitions: int = Field(1, ge=1, le=5)
    prompt_ids: dict[Dimension, Annotated[int, Field(ge=1)]] = Field(default_factory=dict)


class PromptInput(InputModel):
    name: Name
    dimension: Dimension
    template: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class PromptInfo(PromptInput):
    id: int
    version: int
    model_config = ConfigDict(from_attributes=True)


class PromptPreview(InputModel):
    stimulus: Stimulus
    template: Annotated[str, StringConstraints(max_length=4000)] | None = None


class PromptRendered(BaseModel):
    text: str
    schema_: dict = Field(serialization_alias="schema")


class Queued(BaseModel):
    experiment_id: int
    response_id: int | None = None


class ResponseSummary(BaseModel):
    id: int
    experiment_id: int
    dimension: Dimension
    stimulus: Stimulus
    item_key: str
    provider: str
    model: str
    trial: int
    state: str
    error: str | None
    preview: str
    created_at: datetime
    finished_at: datetime | None = None


class ResponseDetail(ResponseSummary):
    raw_output: str | None
    parsed_output: dict | None
    prompt_rendered: str
    reference: dict
    execution: dict


class HistoryPage(BaseModel):
    items: list[ResponseSummary]
    total: int
    page: int
    page_size: int


class ModelProgress(BaseModel):
    provider: str
    model: str
    counts: dict[str, int]


class ExperimentInfo(BaseModel):
    id: int
    name: str
    state: str
    kind: str
    repetitions: int
    created_at: datetime
    counts: dict[str, int]


class ExperimentDetail(ExperimentInfo):
    protocol: dict
    responses: HistoryPage
    models: list[ModelProgress]


class RuleTest(InputModel):
    word: Text


class RulePrediction(BaseModel):
    underlying: str
    surface: str
    rule_evidence: Literal["verified_on_examples", "programmatic_hypothesis"]
