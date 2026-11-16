from django.db import models

from apps.common.models import BaseModel


class IssueCategory(models.TextChoices):
    INJECTION = "injection", "Injection"
    CROSS_SITE_SCRIPTING = "cross_site_scripting", "Cross-Site Scripting"
    BROKEN_ACCESS_CONTROL = "broken_access_control", "Broken Access Control"
    AUTHENTICATION_SESSION = "authentication_session", "Authentication & Session Management"
    CRYPTOGRAPHIC_FAILURES = "cryptographic_failures", "Cryptographic Failures"
    SECRETS_EXPOSURE = "secrets_exposure", "Secrets Exposure"
    VULNERABLE_COMPONENTS = "vulnerable_components", "Vulnerable & Outdated Components"
    SECURITY_MISCONFIGURATION = "security_misconfiguration", "Security Misconfiguration"
    INFORMATION_DISCLOSURE = "information_disclosure", "Information Disclosure"
    INSECURE_DESIGN = "insecure_design", "Insecure Design & Code Quality"
    INFRASTRUCTURE_AS_CODE = "infrastructure_as_code", "Infrastructure as Code"
    TRANSPORT_SECURITY = "transport_security", "Transport Layer Security"


class RemediationPriority(models.TextChoices):
    P1 = "P1", "P1 - Fix immediately"
    P2 = "P2", "P2 - Fix this sprint"
    P3 = "P3", "P3 - Plan fix"
    P4 = "P4", "P4 - Backlog / hardening"


class VulnerabilityClass(BaseModel):
    """
    Curated knowledge entry: what an issue is, why it matters, and how to fix it in general.
    Findings are linked here so every report carries a consistent explanation and generic fix,
    independent of which engine produced the raw finding.
    """
    slug = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=150)
    issue_category = models.CharField(max_length=40, choices=IssueCategory.choices, db_index=True)
    owasp_category = models.CharField(max_length=80, blank=True)
    cwe_ids = models.JSONField(default=list, help_text='e.g. ["CWE-89"]; used to match findings')
    match_keywords = models.JSONField(default=list, help_text="lowercase substrings matched against rule id / title")
    explanation = models.TextField(help_text="What the issue is")
    business_impact = models.TextField(help_text="Why it matters if exploited")
    remediation_steps = models.JSONField(default=list, help_text="Ordered generic fix recommendations")
    base_priority = models.CharField(max_length=2, choices=RemediationPriority.choices, default=RemediationPriority.P3)
    references = models.JSONField(default=list)

    class Meta(BaseModel.Meta):
        ordering = ("issue_category", "name")
        verbose_name_plural = "vulnerability classes"

    def __str__(self):
        return self.name
