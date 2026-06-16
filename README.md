# HackEvent: Maternal Outreach Decision Cockpit

## USER

**Named user:** Asha, District Program Lead at a public-health NGO.

**Recurring decision:** Which district should receive this week's limited maternal health outreach team?

**Who is helped:** Women and families in underserved districts. The app prioritizes districts where anaemia is high and birth-support conditions are weaker, so a scarce outreach team can be sent where the data suggests the highest preventable maternal-health risk.

## WORKFLOW

1. The app reads the DAIS 2026 hackathon dataset from Lakebase Postgres. The synced source table is `hackevent_lakebase.public.nfhs_5_district_health_indicators`.
2. Asha opens one primary screen: the named user and recurring decision are stated at the top.
3. The Asha Outreach Agent ranks districts using live Lakebase evidence and returns one recommendation.
4. The UI shows the confidence score, uncertainty factors, and a visually obvious "Based on these records" list with NFHS-5 record IDs and row-level metrics.
5. Asha reviews the recommendation and clicks **Commit this outreach decision**.
6. The action is written back to Lakebase table `app.outreach_decisions` and immediately appears as the latest written-back record.

### 3-minute demo script

Open with the decision: "Asha has one maternal health outreach team this week. She needs to choose one district, not browse a dashboard."

Show the top of the app: point to the named user, the recurring decision, and the live data scope.

Show the recommendation: identify the selected district, confidence score, and tradeoff. Call out that the app does not hide uncertainty; it says when the data is survey-level and when source tables could not be synced safely.

Show evidence: scroll to "Based on these records" and point to the record IDs, source table, primary keys, and metrics used by the recommendation.

Close the loop: click the commit button and show the newest `app.outreach_decisions` record appear in the UI.

## TECHNICAL APPROACH

- **Databricks Apps + AppKit:** React, TypeScript, Tailwind, shadcn-style AppKit UI components, and an Express server hosted as a Databricks App.
- **Lakebase:** The app uses Lakebase Postgres for sub-second operational reads and write-back state.
- **Synced dataset:** The NFHS-5 district health indicators table is synced from Unity Catalog into Lakebase with primary key `(state_ut, district_name)`.
- **Agent Bricks / Model Serving:** The backend wires the Databricks Model Serving endpoint `databricks-gpt-oss-20b` through the AppKit serving plugin for recommendation synthesis. The evidence policy and ranking are deterministic so the happy-path demo remains reliable even if model synthesis is slow or unavailable.
- **Evidence policy:** Districts are ranked by a maternal-health risk score using anaemia, institutional birth coverage, sanitation, clean fuel, and women's literacy. The model receives only the top Lakebase evidence rows and must not invent records.
- **Write-back loop:** Committed recommendations are inserted into `app.outreach_decisions` with citations and uncertainty JSON, making the human decision auditable.

### Local commands

```bash
npm install
npm run dev
```

The app runs at `http://localhost:8000`.

### Validation

```bash
npm run typecheck
databricks apps validate --profile sandbox
npm run test:smoke
```

## KEY TRADEOFFS

- **Reliability over pure generative autonomy:** The recommendation uses deterministic Lakebase scoring first, then optional Databricks model synthesis. That keeps the demo dependable while still using Agent Bricks / Model Serving for the agent narrative.
- **One synced table over unsafe broad sync:** The facilities and pincode source tables contain duplicate keys that violate direct Lakebase sync constraints. The app keeps the operational loop on the clean NFHS-5 district table instead of building on unreliable keys.
- **Survey-level confidence:** NFHS-5 is strong for district-level prioritization but is not a real-time caseload system. The UI lowers certainty and explains that local capacity, transport, and partner context still need human review.
- **Lakebase write-back first:** The committed action is immediately available in Lakebase. A Lakebase-to-Unity-Catalog reverse sync is a later platform step and is not required for the local closed-loop demo.
