from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


T = TypeVar("T")
Dimension = Literal["ambiguity", "recursion", "movement", "phonology"]


class Envelope(BaseModel, Generic[T]):
    data: T


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class Profile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    name: str
    role: str


class DemoExample(BaseModel):
    dimension: Dimension
    title: str
    stimulus: str
    task: str
    observation: str
    output: str


class DemoOverview(BaseModel):
    provenance: Literal["synthetic"]
    models: list[str]
    scores: list[dict]
    activity: list[dict]
    examples: list[DemoExample]


class ExperimentSummary(BaseModel):
    id: int
    name: str
    state: str


class WorkspaceOverview(BaseModel):
    provenance: Literal["workspace"] = "workspace"
    datasets: int
    experiments: int
    evaluations: int
    recent: list[ExperimentSummary]
