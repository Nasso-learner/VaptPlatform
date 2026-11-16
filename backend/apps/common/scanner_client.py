"""HTTP client for the internal FastAPI scanner service (the only component with Docker access)."""
import httpx
from django.conf import settings


class ScannerServiceError(RuntimeError):
    pass


class ScannerClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self._http = httpx.Client(
            base_url=base_url or settings.SCANNER_SERVICE_URL,
            headers={"X-Scanner-Key": api_key or settings.SCANNER_API_KEY},
            timeout=httpx.Timeout(connect=10, read=5400, write=30, pool=30),  # engines can run for up to 90 minutes
        )

    def _request(self, method: str, path: str, **kwargs):
        try:
            response = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise ScannerServiceError(f"scanner service unreachable: {exc}") from exc
        if response.status_code >= 400:
            detail = response.json().get("detail") if response.headers.get("content-type", "").startswith("application/json") else response.text
            raise ScannerServiceError(str(detail)[:2000])
        return response.json() if response.content else None

    def validate_repository(self, repository_url: str, branch: str | None, token: str | None) -> dict:
        return self._request("POST", "/v1/repos/validate", json={"repo_url": repository_url, "branch": branch or None, "token": token})

    def create_workspace(self, repository_url: str, branch: str | None, commit_sha: str, token: str | None) -> str:
        payload = {"repo_url": repository_url, "branch": branch or None, "commit_sha": commit_sha, "token": token}
        return self._request("POST", "/v1/workspaces", json=payload)["workspace_id"]

    def delete_workspace(self, workspace_id: str) -> None:
        self._request("DELETE", f"/v1/workspaces/{workspace_id}")

    def run_sast_engine(self, workspace_id: str, engine: str) -> dict:
        return self._request("POST", f"/v1/workspaces/{workspace_id}/engines/{engine}")

    def run_dast_engine(self, engine: str, target_url: str, auth_header: str | None, openapi_url: str | None, active: bool) -> dict:
        payload = {"target_url": target_url, "auth_header": auth_header, "openapi_url": openapi_url or None, "active": active}
        return self._request("POST", f"/v1/dast/{engine}", json=payload)

    def close(self):
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
