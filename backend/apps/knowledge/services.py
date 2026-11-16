from .catalog import VULNERABILITY_CATALOG


def sync_catalog(vulnerability_class_model) -> int:
    """Idempotent upsert of the seed catalog. Takes the model so migrations can pass the historical model."""
    for item in VULNERABILITY_CATALOG:
        vulnerability_class_model.objects.update_or_create(slug=item["slug"], defaults={k: v for k, v in item.items() if k != "slug"})
    return len(VULNERABILITY_CATALOG)
