"""Scanner microservice: the only component with Docker access. Internal-only, called by Celery workers."""
import hmac
import os
import time

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException

from . import dast, repos, sast
from .runner import EngineError
from .schemas import DastRequest, EngineResult, RepoRequest, RepoValidation, WorkspaceRequest

API_KEY = os.environ.get("SCANNER_API_KEY", "")
if not API_KEY:
    raise RuntimeError("SCANNER_API_KEY must be set")


def auth(x_scanner_key: str = Header("")):
    if not hmac.compare_digest(x_scanner_key, API_KEY):
        raise HTTPException(401, "invalid scanner key")


app = FastAPI(title="VAPT Scanner Service", version="1.0")
router = APIRouter(prefix="/v1", dependencies=[Depends(auth)])


def _timed(engine: str, version: str, fn) -> EngineResult:
    start = time.monotonic()
    try:
        findings = fn()
    except Exception as e:  # any engine failure is reported to the caller, never crashes the service
        raise HTTPException(422, f"{type(e).__name__}: {e}"[:2000]) from e
    return EngineResult(engine=engine, version=version, duration_ms=int((time.monotonic() - start) * 1000), findings=findings)


@app.get("/health")
def health():
    return {"ok": True}


@router.get("/engines")
def engines():
    return {"sast": sast.IMAGES, "dast": {"builtin": "builtin", **dast.IMAGES}}


@router.post("/repos/validate", response_model=RepoValidation)
def validate_repo(req: RepoRequest):
    try:
        return repos.validate(req.repo_url, req.branch, req.token)
    except EngineError as e:
        return RepoValidation(ok=False, message=str(e))


@router.post("/workspaces")
def create_workspace(req: WorkspaceRequest):
    try:
        return {"workspace_id": repos.create_workspace(req.repo_url, req.branch, req.commit_sha, req.token)}
    except EngineError as e:
        raise HTTPException(422, str(e)) from e


@router.delete("/workspaces/{ws}", status_code=204)
def delete_workspace(ws: str):
    repos.delete_workspace(ws)


@router.post("/workspaces/{ws}/engines/{engine}", response_model=EngineResult)
def run_sast_engine(ws: str, engine: str):
    if engine not in sast.ENGINES:
        raise HTTPException(404, f"unknown SAST engine '{engine}'")
    try:
        src = repos.workspace_src(ws)
    except EngineError as e:
        raise HTTPException(404, str(e)) from e
    return _timed(engine, sast.IMAGES[engine], lambda: sast.ENGINES[engine](src))


@router.post("/dast/{engine}", response_model=EngineResult)
def run_dast_engine(engine: str, req: DastRequest):
    if engine not in dast.ENGINES:
        raise HTTPException(404, f"unknown DAST engine '{engine}'")
    try:
        dast.guard_target(dast.reachable(str(req.target_url)))
    except EngineError as e:
        raise HTTPException(422, str(e)) from e
    version = dast.IMAGES.get(engine, "builtin-1")
    return _timed(engine, version, lambda: dast.unalias(dast.ENGINES[engine](req), str(req.target_url)))


app.include_router(router)
