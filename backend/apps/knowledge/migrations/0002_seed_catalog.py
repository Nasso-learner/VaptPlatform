from django.db import migrations


def seed(apps, schema_editor):
    from apps.knowledge.services import sync_catalog
    sync_catalog(apps.get_model("knowledge", "VulnerabilityClass"))


class Migration(migrations.Migration):
    dependencies = [("knowledge", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
