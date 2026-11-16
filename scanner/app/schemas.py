from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

Severity = Literal["critical", "high", "medium", "low", "info"]
Confidence = Literal["high", "medium", "low"]
Category = Literal["code", "secret", "dependency", "iac", "dast"]


class Finding(BaseModel):
    """The one normalized finding format every engine is converted into."""
    engine: str
    category: Category
    rule_id: str
    title: str
    description: str = ""
    severity: Severity
    confidence: Confidence = "medium"
    cwe: str | None = None
    owasp: str | None = None
    file_path: str | None = None
    line: int | None = None
    url: str | None = None
    method: str | None = None
    param: str | None = None
    evidence: str = ""
    remediation: str = ""
    references: list[str] = Field(default_factory=list)


class EngineResult(BaseModel):
    engine: str
    version: str
    duration_ms: int
    findings: list[Finding]


class RepoRequest(BaseModel):
    repo_url: str
    branch: str | None = None
    token: str | None = None


class RepoValidation(BaseModel):
    ok: bool
    commit_sha: str | None = None
    branch: str | None = None
    default_branch: str | None = None
    access: Literal["admin", "write", "read", "unknown"] = "unknown"
    message: str = ""


class WorkspaceRequest(RepoRequest):
    commit_sha: str


class DastRequest(BaseModel):
    target_url: HttpUrl
    auth_header: str | None = None
    openapi_url: HttpUrl | None = None
    active: bool = False
