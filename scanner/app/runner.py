"""Process + container execution helpers. Everything runs without a shell (no injection)."""
import os
import subprocess

WORK_DIR = os.environ.get("WORK_DIR", "/work")            # path inside this container
WORK_VOLUME = os.environ.get("WORK_VOLUME", "vapt-work")  # same volume, by name, for sibling engine containers

# Hardening applied to every engine container.
SANDBOX = [
    "--rm",
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "--memory=3g",
    "--cpus=2",
    "--pids-limit=2048",
    "--add-host=host.docker.internal:host-gateway",
]


class EngineError(RuntimeError):
    pass


def run(cmd: list[str], timeout: int = 1800, env: dict | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              env={**os.environ, **(env or {})}, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired as e:
        raise EngineError(f"{cmd[0]} timed out after {timeout}s") from e


def docker(args: list[str], timeout: int = 1800) -> subprocess.CompletedProcess:
    return run(["docker", "run", *SANDBOX, *args], timeout=timeout)


def tail(s: str, n: int = 1500) -> str:
    return (s or "")[-n:]
