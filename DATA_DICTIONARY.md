# Data Dictionary

## Lakebase Tables

### `public.nfhs_5_district_health_indicators`

- Source: `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators`
- Rows: 706
- Columns: 109
- Primary record identity used by the app: `(state_ut, district_name)`
- Relationship: one district health-indicator row can be cited by many committed outreach decisions through `app.outreach_decisions.citations[*].primaryKey`.

Key fields used by the agent:

| Column | Type | Role |
| --- | --- | --- |
| `state_ut` | text | State or union territory in the cited record key |
| `district_name` | text | District in the cited record key |
| `households_surveyed` | double precision | Survey base for confidence |
| `women_15_49_interviewed` | double precision | Survey base for confidence |
| `all_w15_49_who_are_anaemic_pct` | double precision | Anaemia burden signal |
| `institutional_birth_5y_pct` | double precision | Birth-support access signal |
| `hh_use_improved_sanitation_pct` | double precision | Household condition risk signal |
| `households_using_clean_fuel_for_cooking_pct` | double precision | Household condition risk signal |
| `women_age_15_49_who_are_literate_pct` | double precision | Outreach-access risk signal |

Top scored candidates at build time:

| Rank | District | State | Risk | Anaemia | Institutional births | Sanitation | Clean fuel | Women literacy |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Pakur | Jharkhand | 62.73 | 79.7 | 64.6 | 38.3 | 16.9 | 46.7 |
| 2 | Bijapur | Chhattisgarh | 61.74 | 72.1 | 63.6 | 30.6 | 18.5 | 46.3 |
| 3 | Dumka | Jharkhand | 59.95 | 73.4 | 60.3 | 41.5 | 18.1 | 55.6 |
| 4 | Araria | Bihar | 59.89 | 67.9 | 66.2 | 32.2 | 15.2 | 43.7 |
| 5 | Sukma | Chhattisgarh | 59.55 | 78.4 | 81.2 | 35.5 | 14.4 | 40.5 |

Quality notes:

- `(state_ut, district_name)` is clean in the synced Lakebase table: 706 rows, 706 distinct keys, 0 null key rows.
- The agent's five scoring metrics have 0 nulls across the 706 synced district rows.
- Survey bases vary: `women_15_49_interviewed` ranges from 216 to 1621; `households_surveyed` ranges from 213 to 990.
- Many broader NFHS columns are `text` because the source contains suppression markers such as `*`, parenthesized estimates, and trailing spaces. The app intentionally avoids those text-coded fields in the deterministic risk score.
- Several district names in the source have trailing spaces; the backend trims display values and citation IDs.
- The source is survey-level NFHS-5 data, not a real-time facility/caseload feed. The UI exposes this as an uncertainty factor.

### `app.outreach_decisions`

- Rows at local verification: 2
- Purpose: Lakebase write-back table for committed human decisions.
- Relationship: each decision stores cited source rows in `citations` JSONB.

| Column | Type | Role |
| --- | --- | --- |
| `id` | bigint | Primary key |
| `created_at` | timestamp with time zone | Commit timestamp |
| `decision_week` | text | Operational week |
| `user_name` | text | Named decision-maker |
| `selected_state` | text | Selected source state |
| `selected_district` | text | Selected source district |
| `action` | text | Committed outreach action |
| `confidence_label` | text | Human-readable confidence |
| `confidence_score` | double precision | Numeric confidence |
| `risk_score` | double precision | Deterministic score persisted with action |
| `citations` | jsonb | Source records used by recommendation |
| `uncertainty` | jsonb | Uncertainty factors shown to user |
| `rationale` | text | Agent rationale |
| `status` | text | Action status |

## Source Tables Not Synced Into Lakebase

The Marketplace dataset also includes `facilities` and `india_post_pincode_directory`. Direct Lakebase sync was not used for the app because source-key quality would make the operational loop less reliable:

- `facilities`: 10,088 rows, 51 columns; `unique_id` is duplicated, so it is not a safe direct primary key.
- `india_post_pincode_directory`: 165,627 rows, 11 columns; duplicate rows violate direct primary-key sync assumptions.

This is the main technical tradeoff: use the clean district-level synced table for a reliable live demo, and surface the missing facility/pincode context as uncertainty instead of pretending the app has exact logistics data.
