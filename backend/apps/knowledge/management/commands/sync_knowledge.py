from django.core.management.base import BaseCommand

from apps.knowledge.models import VulnerabilityClass
from apps.knowledge.services import sync_catalog


class Command(BaseCommand):
    help = "Create/update vulnerability classes from apps/knowledge/catalog.py"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS(f"synced {sync_catalog(VulnerabilityClass)} vulnerability classes"))
