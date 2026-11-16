"""Repository validation and safe cloning of an exact revision."""
import base64
import os
import re
import shutil
import uuid
from urllib.parse import quote, urlparse

import httpx

from .runner import WORK_DIR, EngineError, run, tail
from .schemas import RepoValidation

ALLOWED_HOSTS = [h.strip().lower() for h in os.environ.get("ALLOWED_GIT_HOSTS", "github.com,gitlab.com,bitbucket.org").split(",")]
MAX_REPO_MB = int(os.environ.get("MAX_REPO_MB", "1024"))
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")


def check_url(url: str) -> str:
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not host or u.username or u.password:
        raise EngineError("repo_url must be https://host/owner/repo without embedded credentials")
    if "*" not in ALLOWED_HOSTS and host not in ALLOWED_HOSTS:
        raise EngineError(f"git host '{host}' is not allowed (ALLOWED_GIT_HOSTS={','.join(ALLOWED_HOSTS)})")
    return host


def git_env(host: str, token: str | None) -> dict:
    """Credentials go in via env config, never argv or .git/config, so they can't leak into the clone."""
    env = {"GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}
    if token:
        user = {"github.com": "x-access-token", "gitlab.com": "oauth2", "bitbucket.org": "x-token-auth"}.get(host, "git")
        basic = base64.b64encode(f"{user}:{token}".encode()).decode()
        env |= {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraHeader", "GIT_CONFIG_VALUE_0": f"Authorization: Basic {basic}"}
    return env


SAFE_GIT = ["git", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
            "-c", "core.hooksPath=/dev/null", "-c", "core.symlinks=false"]


def redact(s: str, token: str | None) -> str:
    return s.replace(token, "***") if token else s


def validate(repo_url: str, branch: str | None, token: str | None) -> RepoValidation:
    host = check_url(repo_url)
    if branch and not BRANCH_RE.match(branch):
        return RepoValidation(ok=False, message="invalid branch name")
    r = run([*SAFE_GIT, "ls-remote", "--symref", "--", repo_url, "HEAD", *([f"refs/heads/{branch}"] if branch else [])],
            timeout=60, env=git_env(host, token))
    if r.returncode != 0:
        return RepoValidation(ok=False, message="cannot access repository: " + tail(redact(r.stderr, token), 400))
    default = re.search(r"^ref: refs/heads/(\S+)\s+HEAD$", r.stdout, re.M)
    default_branch = default.group(1) if default else None
    target = branch or default_branch
    ref = f"refs/heads/{re.escape(branch)}" if branch else "HEAD"
    sha = re.search(rf"^([0-9a-f]{{40}})\s+{ref}$", r.stdout, re.M)
    if not sha:
        return RepoValidation(ok=False, default_branch=default_branch, message=f"branch '{branch}' not found")
    return RepoValidation(ok=True, commit_sha=sha.group(1), branch=target, default_branch=default_branch,
                          access=access_level(host, repo_url, token),
                          message="repository reachable")


def access_level(host: str, repo_url: str, token: str | None) -> str:
    """Ownership check: what the supplied token can do on this repo (write/admin = proven maintainer)."""
    if not token:
        return "read"
    path = urlparse(repo_url).path.strip("/").removesuffix(".git")
    try:
        if host == "github.com":
            r = httpx.get(f"https://api.github.com/repos/{path}", timeout=15,
                          headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
            p = r.json().get("permissions", {}) if r.status_code == 200 else {}
            return "admin" if p.get("admin") else "write" if p.get("push") else "read"
        if host == "gitlab.com":
            r = httpx.get(f"https://gitlab.com/api/v4/projects/{quote(path, safe='')}", timeout=15, headers={"PRIVATE-TOKEN": token})
            perms = r.json().get("permissions", {}) if r.status_code == 200 else {}
            level = max((perms.get(k) or {}).get("access_level", 0) for k in ("project_access", "group_access"))
            return "admin" if level >= 40 else "write" if level >= 30 else "read"
    except (httpx.HTTPError, ValueError):
        pass
    return "unknown"


def create_workspace(repo_url: str, branch: str | None, commit_sha: str, token: str | None) -> str:
    host = check_url(repo_url)
    if not SHA_RE.match(commit_sha):
        raise EngineError("commit_sha must be a full 40-char SHA")
    if branch and not BRANCH_RE.match(branch):
        raise EngineError("invalid branch name")
    ws = uuid.uuid4().hex
    root = os.path.join(WORK_DIR, ws)
    src = os.path.join(root, "src")
    os.makedirs(root)
    os.chmod(root, 0o777)  # engines like ZAP run as non-root and write reports here
    env = git_env(host, token)
    r = run([*SAFE_GIT, "clone", "--quiet", "--no-tags", "--single-branch", *(["--branch", branch] if branch else []),
             "--", repo_url, src], timeout=900, env=env)
    if r.returncode != 0:
        delete_workspace(ws)
        raise EngineError("git clone failed: " + tail(redact(r.stderr, token), 400))
    r = run([*SAFE_GIT, "-C", src, "checkout", "--quiet", "--detach", commit_sha], timeout=120, env=env)
    if r.returncode != 0:
        delete_workspace(ws)
        raise EngineError("commit not found on branch: " + tail(r.stderr, 300))
    size_mb = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(src) for f in fs) / 1e6
    if size_mb > MAX_REPO_MB:
        delete_workspace(ws)
        raise EngineError(f"repository is {size_mb:.0f} MB, limit is {MAX_REPO_MB} MB")
    return ws


def workspace_src(ws: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{32}", ws) or not os.path.isdir(os.path.join(WORK_DIR, ws, "src")):
        raise EngineError("unknown workspace")
    return os.path.join(WORK_DIR, ws, "src")


def delete_workspace(ws: str) -> None:
    if re.fullmatch(r"[0-9a-f]{32}", ws):
        shutil.rmtree(os.path.join(WORK_DIR, ws), ignore_errors=True)
