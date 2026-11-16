"""
Risk model.

finding_risk = severity_base x confidence_factor x impact_factor (+ corroboration bonus), clamped to 0..10
priority     = from risk, never lower than the vulnerability class's base priority for high-confidence findings
scan_risk    = highest open finding risk + small density bonus for many high/critical findings
"""
from datetime import date, timedelta
from decimal import Decimal

SEVERITY_BASE = {"critical": 9.5, "high": 7.5, "medium": 5.0, "low": 2.5, "info": 0.5}
CONFIDENCE_FACTOR = {"high": 1.0, "medium": 0.85, "low": 0.65}
IMPACT_FACTOR = {"secret": 1.1, "code": 1.0, "dast": 1.05, "dependency": 0.95, "iac": 0.85}
CORROBORATION_BONUS = 0.5  # reported independently by more than one engine

PRIORITY_THRESHOLDS = (("P1", 8.5), ("P2", 6.5), ("P3", 3.5))
PRIORITY_RANK = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}
FIX_SLA_DAYS = {"P1": 7, "P2": 30, "P3": 90, "P4": 180}


def calculate_finding_risk(*, severity: str, confidence: str, source_type: str, engine_count: int = 1) -> Decimal:
    score = SEVERITY_BASE[severity] * CONFIDENCE_FACTOR.get(confidence, 0.85) * IMPACT_FACTOR.get(source_type, 1.0)
    if engine_count > 1:
        score += CORROBORATION_BONUS
    return Decimal(str(round(min(max(score, 0.0), 10.0), 2)))


def calculate_priority(*, risk_score: Decimal, severity: str, confidence: str, class_base_priority: str | None) -> str:
    if severity == "info":
        return "P4"
    priority = next((p for p, threshold in PRIORITY_THRESHOLDS if float(risk_score) >= threshold), "P4")
    # The knowledge base knows e.g. exposed secrets are always urgent: escalate confident findings to its base priority.
    if class_base_priority and confidence == "high" and PRIORITY_RANK[class_base_priority] < PRIORITY_RANK[priority]:
        priority = class_base_priority
    return priority


def calculate_fix_due_date(priority: str, from_date: date | None = None) -> date:
    return (from_date or date.today()) + timedelta(days=FIX_SLA_DAYS[priority])


def calculate_scan_risk(open_risk_scores: list[Decimal], high_or_critical_count: int) -> tuple[Decimal | None, str]:
    if not open_risk_scores:
        return Decimal("0.00"), "A"
    score = min(10.0, float(max(open_risk_scores)) + min(1.0, 0.05 * high_or_critical_count))
    grade = "A" if score < 1 else "B" if score < 4 else "C" if score < 6 else "D" if score < 8 else "F"
    return Decimal(str(round(score, 2))), grade
