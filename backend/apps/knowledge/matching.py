from .catalog import FALLBACK_BY_SOURCE
from .models import VulnerabilityClass


class KnowledgeMatcher:
    """
    Maps a normalized finding to a VulnerabilityClass. Built once per ingestion (one query),
    then each lookup is in-memory. Match order: CWE -> keyword (longest wins) -> source-type fallback.
    """

    def __init__(self):
        self.classes = list(VulnerabilityClass.objects.all())
        self.by_slug = {vc.slug: vc for vc in self.classes}
        self.by_cwe: dict[str, VulnerabilityClass] = {}
        for vc in self.classes:
            for cwe in vc.cwe_ids:
                self.by_cwe.setdefault(cwe.upper(), vc)
        self.keywords = sorted(((kw.lower(), vc) for vc in self.classes for kw in vc.match_keywords), key=lambda kv: -len(kv[0]))

    def match(self, *, cwe_id: str | None, rule_id: str, issue_name: str, source_type: str) -> VulnerabilityClass | None:
        if cwe_id and cwe_id.upper() in self.by_cwe:
            return self.by_cwe[cwe_id.upper()]
        haystack = f"{rule_id} {issue_name}".lower()
        for keyword, vc in self.keywords:
            if keyword in haystack:
                return vc
        return self.by_slug.get(FALLBACK_BY_SOURCE.get(source_type, ""))
