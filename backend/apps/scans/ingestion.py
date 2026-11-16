"""
Steps 5-6 of the pipeline: normalize engine output into Finding rows, deduplicate across engines,
classify against the knowledge base, score risk/priority, and carry triage decisions across scans.
"""
import hashlib
from collections import Counter
from urllib.parse import urlsplit, urlunsplit

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.knowledge.matching import KnowledgeMatcher
from apps.knowledge.models import IssueCategory

from .models import SEVERITY_ORDER, STICKY_TRIAGE_STATUSES, Finding, Scan, ScanStatus, TriageStatus
from .scoring import calculate_finding_risk, calculate_fix_due_date, calculate_priority, calculate_scan_risk

CONFIDENCE_ORDER = ["high", "medium", "low"]


def normalize_url(url: str | None) -> str:
    if not url:
        return ""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", "", ""))


def compute_fingerprint(raw: dict) -> str:
    """Same real-world issue => same fingerprint, regardless of which engine found it or which scan."""
    source_type = raw["category"]
    if source_type == "secret":
        key = ("secret", raw.get("file_path"), raw.get("line"))
    elif source_type == "dependency":
        key = ("dependency", raw.get("rule_id"), raw.get("file_path"), raw.get("evidence", "").split(" ")[0])
    elif source_type == "dast":
        key = ("dast", raw.get("cwe") or raw.get("title", "").lower(), normalize_url(raw.get("url")), raw.get("param") or "")
    else:  # code, iac
        key = (source_type, raw.get("cwe") or raw.get("rule_id"), raw.get("file_path"), raw.get("line"))
    return hashlib.sha256("|".join(str(part or "") for part in key).encode()).hexdigest()


def merge_duplicates(raw_findings: list[dict]) -> list[dict]:
    """Collapse findings with the same fingerprint; keep the most severe/confident version, record every engine."""
    merged: dict[str, dict] = {}
    for raw in raw_findings:
        fingerprint = compute_fingerprint(raw)
        current = merged.get(fingerprint)
        if current is None:
            merged[fingerprint] = {**raw, "fingerprint": fingerprint, "detected_by": [raw["engine"]]}
            continue
        if raw["engine"] not in current["detected_by"]:
            current["detected_by"].append(raw["engine"])
        if (SEVERITY_ORDER.index(raw["severity"]), CONFIDENCE_ORDER.index(raw["confidence"])) < \
           (SEVERITY_ORDER.index(current["severity"]), CONFIDENCE_ORDER.index(current["confidence"])):
            current.update({k: v for k, v in raw.items() if v and k not in ("engine",)})
        # Fill gaps (e.g. one engine has the CWE, the other the fix)
        for field in ("cwe", "owasp", "remediation", "evidence", "description"):
            current[field] = current.get(field) or raw.get(field)
    for item in merged.values():
        if len(item["detected_by"]) > 1:
            item["confidence"] = "high"  # independent corroboration
    return list(merged.values())


def _previous_findings_by_fingerprint(scan: Scan) -> dict[str, dict]:
    previous_scan = (Scan.objects.filter(project=scan.project, scan_type=scan.scan_type, status=ScanStatus.COMPLETED,
                                         created_at__lt=scan.created_at).order_by("-created_at").first())
    if previous_scan is None:
        return {}
    rows = previous_scan.findings.values("fingerprint", "first_seen_at", "triage_status", "triage_note", "triaged_by_id", "triaged_at")
    return {row["fingerprint"]: row for row in rows}


@transaction.atomic
def ingest_findings(scan: Scan, raw_findings: list[dict]) -> int:
    matcher = KnowledgeMatcher()
    previous = _previous_findings_by_fingerprint(scan)
    now = timezone.now()
    today = now.date()

    finding_rows = []
    for item in merge_duplicates(raw_findings):
        vulnerability_class = matcher.match(cwe_id=item.get("cwe"), rule_id=item.get("rule_id", ""),
                                            issue_name=item["title"], source_type=item["category"])
        risk_score = calculate_finding_risk(severity=item["severity"], confidence=item["confidence"],
                                            source_type=item["category"], engine_count=len(item["detected_by"]))
        priority = calculate_priority(risk_score=risk_score, severity=item["severity"], confidence=item["confidence"],
                                      class_base_priority=vulnerability_class.base_priority if vulnerability_class else None)
        prior = previous.get(item["fingerprint"])
        sticky = prior and prior["triage_status"] in STICKY_TRIAGE_STATUSES
        finding_rows.append(Finding(
            scan=scan, project_id=scan.project_id, vulnerability_class=vulnerability_class,
            fingerprint=item["fingerprint"], issue_name=item["title"][:300], rule_id=(item.get("rule_id") or "")[:300],
            source_type=item["category"], detected_by=item["detected_by"],
            severity=item["severity"], confidence=item["confidence"], cwe_id=(item.get("cwe") or "")[:20],
            owasp_category=(item.get("owasp") or (vulnerability_class.owasp_category if vulnerability_class else ""))[:80],
            file_path=(item.get("file_path") or "")[:1000], line_number=item.get("line"),
            url=(item.get("url") or "")[:2000], http_method=(item.get("method") or "")[:10], parameter=(item.get("param") or "")[:300],
            description=item.get("description") or "", evidence=(item.get("evidence") or "")[:20000],
            recommended_fix=item.get("remediation") or "", references=item.get("references") or [],
            risk_score=risk_score, priority=priority, fix_due_date=calculate_fix_due_date(priority, today),
            triage_status=prior["triage_status"] if sticky else TriageStatus.OPEN,
            triage_note=prior["triage_note"] if sticky else "",
            triaged_by_id=prior["triaged_by_id"] if sticky else None,
            triaged_at=prior["triaged_at"] if sticky else None,
            first_seen_at=prior["first_seen_at"] if prior else now,
            is_new=prior is None,
        ))
    Finding.objects.bulk_create(finding_rows, batch_size=500)
    refresh_scan_summary(scan)
    return len(finding_rows)


def refresh_scan_summary(scan: Scan) -> None:
    """Recompute denormalized counters on the scan and its project (also called after triage changes)."""
    open_findings = scan.findings.open()
    scan.severity_counts = dict(Counter(open_findings.values_list("severity", flat=True)))
    scan.priority_counts = dict(Counter(open_findings.values_list("priority", flat=True)))
    scan.findings_count = scan.findings.count()
    scan.new_findings_count = scan.findings.filter(is_new=True).count()
    high_or_critical = scan.severity_counts.get("critical", 0) + scan.severity_counts.get("high", 0)
    scan.risk_score, scan.risk_grade = calculate_scan_risk(list(open_findings.values_list("risk_score", flat=True)), high_or_critical)
    scan.save(update_fields=["severity_counts", "priority_counts", "findings_count", "new_findings_count", "risk_score", "risk_grade", "updated_at"])
    refresh_project_summary(scan.project)


def refresh_project_summary(project) -> None:
    """Project risk = worst of its latest completed SAST and DAST scans."""
    latest_scans = [s for s in (
        Scan.objects.filter(project=project, scan_type=t, status__in=(ScanStatus.COMPLETED, ScanStatus.REPORTING)).order_by("-created_at").first()
        for t in ("sast", "dast")) if s]
    if not latest_scans:
        return
    worst = max(latest_scans, key=lambda s: s.risk_score or 0)
    project.latest_risk_score = worst.risk_score
    project.latest_risk_grade = worst.risk_grade
    project.open_findings_count = Finding.objects.open().filter(scan__in=latest_scans).count()
    project.last_scanned_at = max(s.created_at for s in latest_scans)
    project.save(update_fields=["latest_risk_score", "latest_risk_grade", "open_findings_count", "last_scanned_at", "updated_at"])


def issue_category_breakdown(scan: Scan) -> list[dict]:
    """Findings grouped by issue category with severity split, for reports and the scan summary panel."""
    rows = (scan.findings.values("vulnerability_class__issue_category")
            .annotate(total=Count("id"),
                      open=Count("id", filter=Q(triage_status__in=(TriageStatus.OPEN, TriageStatus.CONFIRMED))),
                      critical=Count("id", filter=Q(severity="critical")), high=Count("id", filter=Q(severity="high")),
                      medium=Count("id", filter=Q(severity="medium")), low=Count("id", filter=Q(severity="low")),
                      info=Count("id", filter=Q(severity="info")))
            .order_by("-critical", "-high", "-total"))
    labels = dict(IssueCategory.choices)
    breakdown = []
    for row in rows:
        category = row.pop("vulnerability_class__issue_category") or "uncategorized"
        breakdown.append({"issue_category": category, "issue_category_label": labels.get(category, "Uncategorized"), **row})
    return breakdown
