"""Step 7: build one report context, render it as JSON, HTML (Django template, auto-escaped) or PDF (WeasyPrint)."""
import csv
import io
import json
from collections import defaultdict

from django.core.serializers.json import DjangoJSONEncoder
from django.template.loader import render_to_string
from django.utils import timezone

from apps.knowledge.models import RemediationPriority
from apps.scans.ingestion import issue_category_breakdown
from apps.scans.models import SEVERITY_ORDER, Scan
from apps.scans.scoring import FIX_SLA_DAYS

MAX_DETAILED_FINDINGS_IN_DOCUMENT = 1000  # PDF/HTML stay readable; JSON always contains everything


def build_report_context(scan: Scan) -> dict:
    findings = list(scan.findings.select_related("vulnerability_class").order_by("-risk_score", "issue_name"))
    open_findings = [f for f in findings if f.triage_status in ("open", "confirmed")]
    by_priority = defaultdict(list)
    for finding in open_findings:
        by_priority[finding.priority].append(finding)
    remediation_plan = [{
        "priority": priority.value, "label": priority.label, "sla_days": FIX_SLA_DAYS[priority.value],
        "findings": by_priority.get(priority.value, []),
    } for priority in RemediationPriority]
    return {
        "scan": scan,
        "project": scan.project,
        "generated_at": timezone.now(),
        "severity_order": SEVERITY_ORDER,
        "severity_rows": [{"severity": s, "count": scan.severity_counts.get(s, 0)} for s in SEVERITY_ORDER],
        "issue_categories": issue_category_breakdown(scan),
        "remediation_plan": remediation_plan,
        "findings": findings[:MAX_DETAILED_FINDINGS_IN_DOCUMENT],
        "truncated_count": max(0, len(findings) - MAX_DETAILED_FINDINGS_IN_DOCUMENT),
        "engine_runs": list(scan.engine_runs.all()),
        "open_count": len(open_findings),
    }


def render_html(scan: Scan) -> bytes:
    return render_to_string("reports/scan_report.html", build_report_context(scan)).encode("utf-8")


def render_pdf(scan: Scan) -> bytes:
    from weasyprint import HTML  # imported lazily: needs system Pango libs, only present in the worker image
    return HTML(string=render_html(scan).decode("utf-8")).write_pdf()


def render_json(scan: Scan) -> bytes:
    context = build_report_context(scan)
    project = scan.project
    document = {
        "schema_version": "1.0",
        "generated_at": context["generated_at"],
        "project": {"id": project.id, "name": project.name, "repository_url": project.repository_url, "target_url": project.target_url},
        "scan": {
            "id": scan.id, "type": scan.scan_type, "status": scan.status, "target": scan.target, "branch": scan.branch,
            "commit_sha": scan.commit_sha, "configuration": scan.configuration, "started_at": scan.started_at,
            "completed_at": scan.completed_at, "risk_score": scan.risk_score, "risk_grade": scan.risk_grade,
            "severity_counts": scan.severity_counts, "priority_counts": scan.priority_counts,
        },
        "engines": [{"engine": r.engine, "version": r.engine_version, "status": r.status, "findings": r.raw_findings_count,
                     "duration_ms": r.duration_ms, "error": r.error_message} for r in context["engine_runs"]],
        "issue_categories": context["issue_categories"],
        "findings": [{
            "id": f.id, "fingerprint": f.fingerprint, "issue_name": f.issue_name, "rule_id": f.rule_id,
            "issue_category": f.vulnerability_class.issue_category if f.vulnerability_class else None,
            "vulnerability_class": f.vulnerability_class.name if f.vulnerability_class else None,
            "source_type": f.source_type, "detected_by": f.detected_by, "severity": f.severity, "confidence": f.confidence,
            "risk_score": f.risk_score, "priority": f.priority, "fix_due_date": f.fix_due_date,
            "cwe": f.cwe_id, "owasp": f.owasp_category, "location": f.location,
            "file_path": f.file_path, "line": f.line_number, "url": f.url, "method": f.http_method, "parameter": f.parameter,
            "explanation": f.vulnerability_class.explanation if f.vulnerability_class else "",
            "reason": f.description, "business_impact": f.vulnerability_class.business_impact if f.vulnerability_class else "",
            "evidence": f.evidence, "recommended_fix": f.recommended_fix,
            "generic_remediation": f.vulnerability_class.remediation_steps if f.vulnerability_class else [],
            "references": f.references or (f.vulnerability_class.references if f.vulnerability_class else []),
            "triage_status": f.triage_status, "triage_note": f.triage_note, "is_new": f.is_new, "first_seen_at": f.first_seen_at,
        } for f in scan.findings.select_related("vulnerability_class").order_by("-risk_score")],
    }
    return json.dumps(document, cls=DjangoJSONEncoder, indent=2).encode("utf-8")


SARIF_LEVEL = {"critical": "error", "high": "error", "medium": "warning", "low": "note", "info": "note"}


def render_sarif(scan: Scan) -> bytes:
    """SARIF 2.1.0: uploadable to GitHub code scanning (Security tab). Triaged-away findings are kept but marked suppressed."""
    findings = list(scan.findings.select_related("vulnerability_class").order_by("-risk_score"))
    rules: dict[str, dict] = {}
    results = []
    for f in findings:
        rule_id = f.rule_id or (f.vulnerability_class.slug if f.vulnerability_class else f.issue_name)
        rules.setdefault(rule_id, {
            "id": rule_id, "name": f.issue_name[:120],
            "shortDescription": {"text": f.issue_name},
            "fullDescription": {"text": (f.vulnerability_class.explanation if f.vulnerability_class else f.description) or f.issue_name},
            "help": {"text": "\n".join(f.vulnerability_class.remediation_steps) if f.vulnerability_class else (f.recommended_fix or "See finding.")},
            "properties": {"tags": [t for t in (f.owasp_category, f.cwe_id) if t]},
        })
        uri = f.file_path or f.url or scan.target
        physical = {"artifactLocation": {"uri": uri}}
        if f.line_number:
            physical["region"] = {"startLine": f.line_number}
        result = {
            "ruleId": rule_id, "level": SARIF_LEVEL[f.severity],
            "message": {"text": f"{f.issue_name}. {f.description}".strip()[:1000]},
            "locations": [{"physicalLocation": physical}],
            "partialFingerprints": {"vapt/v1": f.fingerprint},
            "properties": {"security-severity": str(f.risk_score), "severity": f.severity, "priority": f.priority, "detectedBy": f.detected_by},
        }
        if f.triage_status in ("false_positive", "accepted_risk"):
            result["suppressions"] = [{"kind": "external", "justification": f.triage_note or f.triage_status}]
        results.append(result)
    document = {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json", "version": "2.1.0",
        "runs": [{"tool": {"driver": {"name": "VAPT Platform", "informationUri": "https://example.invalid/vapt", "rules": list(rules.values())}},
                  "results": results, "automationDetails": {"id": f"vapt/{scan.scan_type}/{scan.id}"}}],
    }
    return json.dumps(document, indent=2).encode("utf-8")


def _csv_safe(value) -> str:
    """Spreadsheets run cells starting with = + - @ as formulas; evidence is attacker-influenced, so neutralize them."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def render_csv(scan: Scan) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "severity", "priority", "risk_score", "issue", "category", "cwe", "owasp", "source", "detected_by",
                     "location", "url", "parameter", "triage_status", "is_new", "first_seen_at", "fix_due_date"])
    for f in scan.findings.select_related("vulnerability_class").order_by("-risk_score"):
        writer.writerow([_csv_safe(v) for v in (
            f.id, f.severity, f.priority, f.risk_score, f.issue_name, f.vulnerability_class.issue_category if f.vulnerability_class else "",
            f.cwe_id, f.owasp_category, f.source_type, ";".join(f.detected_by), f.location, f.url, f.parameter, f.triage_status, f.is_new,
            f.first_seen_at.isoformat(), f.fix_due_date or "")])
    return buffer.getvalue().encode("utf-8-sig")  # BOM so Excel opens it as UTF-8


RENDERERS = {"pdf": render_pdf, "html": render_html, "json": render_json, "sarif": render_sarif, "csv": render_csv}
