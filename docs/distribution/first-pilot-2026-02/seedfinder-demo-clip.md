---
artifact: seedfinder-demo-clip
artifact_stage: generated
source_url: "https://en.seedfinder.eu/strain-info/Blue_Dream/"
source_fixture: "tests/templates/fixtures/seedfinder-strain.html"
clip_timestamp: "2026-02-27T18:44:07.485Z"
template_used: "SeedFinder"
generation_flow: "extractWebPageContent -> buildFrontmatterFromClip -> buildFrontmatterYaml"
quality_gate_evidence_ref: "IMPLEMENTATION_PLAN.md — TP002 Freshness Evidence (Current Outreach Window), branch gatekeeper-test, commit 49293b1"
---

# SeedFinder Demo Clip (Blue Dream)

## Quality Check (TP004)
- ✅ Clean markdown body starts with canonical title and deterministic `## Strain Profile` block.
- ✅ Frontmatter exposes SeedFinder signal keys (`seedfinder_lineage`, potency, flowering, breeder, aroma, raw source fields).
- ✅ Template provenance is visible (`template_used: SeedFinder`) with reproducible fixture/source metadata.

## How to review this demo artifact (under 2 minutes)
1. **Provenance check (20s):** Confirm frontmatter has `source_url`, `clip_timestamp`, `template_used`, and `quality_gate_evidence_ref`.
2. **Signal visibility check (40s):** In the YAML, verify `seedfinder_lineage`, THC/CBD fields, flowering range, breeder, and aroma are present (including `seedfinder_raw_*` values).
3. **Readable output check (40s):** In the markdown body, confirm `# Blue Dream` + `## Strain Profile` render cleanly and match the key values in frontmatter.
4. **Decision check (20s):** If all three checks pass, treat this artifact as pilot-shareable; if not, log the mismatch and block send.

## Generated Frontmatter (signal visibility)
```yaml
---
source: "https://en.seedfinder.eu/strain-info/Blue_Dream/"
title: "Blue Dream"
author: "Humboldt Seed Organization"
date_clipped: "2026-02-27T18:44:07.485Z"
tags:
  - "web-clip"
type: "article"
keywords:
  - "Blue Dream"
  - "Sativa-leaning"
  - "Berry Terps"
lineage: "Blueberry x Haze"
lineage_parents:
  - "Blueberry"
  - "Haze"
page_type: "web"
published_date: "2025-11-03"
seedfinder_aroma:
  - "Berry"
  - "Sweet"
  - "Herbal"
seedfinder_breeder: "Humboldt Seed Organization"
seedfinder_cbd_comparator: "<"
seedfinder_cbd_max_percent: 1
seedfinder_cbd_raw: "<1%"
seedfinder_flowering_max_days: 70
seedfinder_flowering_max_weeks: 10
seedfinder_flowering_min_days: 63
seedfinder_flowering_min_weeks: 9
seedfinder_flowering_raw: "63-70 days"
seedfinder_lineage: "Blueberry x Haze"
seedfinder_lineage_parents:
  - "Blueberry"
  - "Haze"
seedfinder_raw_aroma:
  - "Berry"
  - "Sweet"
  - "Herbal"
seedfinder_raw_breeder: "Humboldt Seed Organization"
seedfinder_raw_cbd: "<1%"
seedfinder_raw_flowering: "63-70 days"
seedfinder_raw_lineage: "Blueberry × Haze"
seedfinder_raw_lineage_parents:
  - "Blueberry"
  - "Haze"
seedfinder_raw_thc: "17-24%"
seedfinder_thc_max_percent: 24
seedfinder_thc_min_percent: 17
seedfinder_thc_raw: "17-24%"
---
```

## Generated Clip Markdown
```markdown
# Blue Dream

## Strain Profile

- **Lineage**: Blueberry x Haze
- **Lineage Parents**: Blueberry, Haze
- **THC**: 17-24%
- **CBD**: <1%
- **Flowering**: 63-70 days (9-10 weeks)
- **Breeder**: Humboldt Seed Organization
- **Aroma**: Berry, Sweet, Herbal

## Profile

Blue Dream is a balanced hybrid known for sweet berry aromas, clear-headed euphoria, and reliable garden vigor. This profile blends user reports with breeder and community grow observations.

## Genetics & Morphology

Cross of Blueberry x Haze. Breeder notes also describe the parentage as Blueberry (mother) x Haze (father). Plants show medium internodal spacing, moderate stretch in early flower, and resin-heavy calyx stacking.

## Effects

Fast cerebral lift followed by calm body relaxation. Commonly reported for daytime stress relief and creative focus when dosed lightly.

## Grow Notes

Flowering time averages 9-10 weeks indoors. Outdoors, harvest usually lands in early to mid-October in temperate climates.
```
