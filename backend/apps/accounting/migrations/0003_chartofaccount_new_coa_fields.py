"""
Migration 0003 — adds account_nature, is_group, is_posting_allowed, level_no
to ChartOfAccount and back-fills values for existing rows.
"""

from django.db import migrations, models


# ── Data migration: populate new fields for existing rows ───────────────────

def _compute_level(pk, table, cache):
    """Recursively compute level_no for an account, caching results."""
    if pk in cache:
        return cache[pk]
    row = table.get(pk)
    if row is None or row["parent_id"] is None:
        cache[pk] = 1
        return 1
    level = _compute_level(row["parent_id"], table, cache) + 1
    cache[pk] = level
    return level


def populate_coa_fields(apps, schema_editor):
    ChartOfAccount = apps.get_model("accounting", "ChartOfAccount")

    DEBIT_TYPES = {"ASSET", "EXPENSE"}

    # Index all accounts by PK
    all_accts = {
        str(a.pk): {"parent_id": str(a.parent_id) if a.parent_id else None, "account_type": a.account_type}
        for a in ChartOfAccount.objects.all()
    }

    level_cache = {}

    to_update = []
    for a in ChartOfAccount.objects.all():
        pk = str(a.pk)
        a.account_nature = "DEBIT" if all_accts[pk]["account_type"] in DEBIT_TYPES else "CREDIT"
        a.level_no = _compute_level(pk, all_accts, level_cache)
        a.is_group = False           # will be set in the propagation pass below
        a.is_posting_allowed = True
        to_update.append(a)

    ChartOfAccount.objects.bulk_update(to_update, ["account_nature", "level_no", "is_group", "is_posting_allowed"])

    # Mark every account that has at least one active child as a group
    parent_ids = set(
        ChartOfAccount.objects.filter(parent__isnull=False)
        .values_list("parent_id", flat=True)
    )
    ChartOfAccount.objects.filter(pk__in=parent_ids).update(is_group=True, is_posting_allowed=False)


class Migration(migrations.Migration):

    dependencies = [
        ("accounting", "0002_rename_accounting_coa_type_idx_accounting__account_cc17c6_idx_and_more"),
    ]

    operations = [
        # ── New fields ────────────────────────────────────────────────────────
        migrations.AddField(
            model_name="chartofaccount",
            name="account_nature",
            field=models.CharField(
                choices=[("DEBIT", "Debit"), ("CREDIT", "Credit")],
                default="DEBIT",
                max_length=6,
            ),
        ),
        migrations.AddField(
            model_name="chartofaccount",
            name="is_group",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="chartofaccount",
            name="is_posting_allowed",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="chartofaccount",
            name="level_no",
            field=models.PositiveSmallIntegerField(default=1),
        ),
        # ── Index on (parent, code) for fast children lookups ─────────────────
        migrations.AddIndex(
            model_name="chartofaccount",
            index=models.Index(fields=["parent", "code"], name="accounting__parent_code_idx"),
        ),
        # ── Back-fill existing rows ───────────────────────────────────────────
        migrations.RunPython(populate_coa_fields, migrations.RunPython.noop),
    ]
