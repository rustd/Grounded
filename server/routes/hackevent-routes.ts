import { Application, Request } from 'express';

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface ServingInvokeResult {
  ok: boolean;
  data?: unknown;
  message?: string;
}

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<QueryResult>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
  serving?: (alias?: string) => {
    invoke(body: Record<string, unknown>): Promise<ServingInvokeResult>;
    asUser(req: Request): {
      invoke(body: Record<string, unknown>): Promise<ServingInvokeResult>;
    };
  };
}

interface CandidateRow {
  recordId: string;
  state: string;
  district: string;
  householdsSurveyed: number | null;
  womenInterviewed: number | null;
  water: number | null;
  sanitation: number | null;
  cleanFuel: number | null;
  institutionalBirth: number | null;
  womenLiteracy: number | null;
  anaemia: number | null;
  riskScore: number;
}

const NFHS_TABLE = 'public.nfhs_5_district_health_indicators';
const DECISIONS_TABLE = 'app.outreach_decisions';
const AGENT_ENDPOINT_NAME = 'databricks-gpt-oss-20b';

const syncStatus = {
  mode: 'SNAPSHOT',
  source: 'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset',
  lakebaseCatalog: 'hackevent_lakebase',
  onlineTable: 'hackevent_lakebase.public.nfhs_5_district_health_indicators',
  syncedTables: [
    {
      name: 'nfhs_5_district_health_indicators',
      status: 'configured',
      detail: 'Snapshot sync created with primary key (state_ut, district_name).',
    },
    {
      name: 'app.outreach_decisions',
      status: 'write-back table',
      detail: 'Human commitments are stored in Lakebase and immediately visible in the app loop.',
    },
    {
      name: 'facilities',
      status: 'not synced',
      detail: 'Direct Marketplace sync failed because the source has duplicate unique_id values.',
    },
    {
      name: 'india_post_pincode_directory',
      status: 'not synced',
      detail: 'Direct Marketplace sync failed because duplicate rows violate any direct primary key.',
    },
  ],
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serializeRows(rows: Record<string, unknown>[]) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]),
    ),
  );
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function recordId(state: string, district: string) {
  return `NFHS5:${state.toUpperCase().replace(/\s+/g, '_')}:${district.toUpperCase().replace(/\s+/g, '_')}`;
}

function mapCandidate(row: Record<string, unknown>): CandidateRow {
  const state = String(row.state_ut ?? '').trim();
  const district = String(row.district_name ?? '').trim();
  const anaemia = toNumber(row.all_w15_49_who_are_anaemic_pct);
  const institutionalBirth = toNumber(row.institutional_birth_5y_pct);
  const sanitation = toNumber(row.hh_use_improved_sanitation_pct);
  const cleanFuel = toNumber(row.households_using_clean_fuel_for_cooking_pct);
  const womenLiteracy = toNumber(row.women_age_15_49_who_are_literate_pct);
  const water = toNumber(row.hh_improved_water_pct);
  const householdsSurveyed = toNumber(row.households_surveyed);
  const womenInterviewed = toNumber(row.women_15_49_interviewed);
  const riskScore =
    (anaemia ?? 0) * 0.35 +
    (100 - (institutionalBirth ?? 100)) * 0.25 +
    (100 - (sanitation ?? 100)) * 0.2 +
    (100 - (cleanFuel ?? 100)) * 0.1 +
    (100 - (womenLiteracy ?? 100)) * 0.1;

  return {
    recordId: recordId(state, district),
    state,
    district,
    householdsSurveyed,
    womenInterviewed,
    water,
    sanitation,
    cleanFuel,
    institutionalBirth,
    womenLiteracy,
    anaemia,
    riskScore: round(riskScore, 2),
  };
}

function confidenceFor(candidates: CandidateRow[]) {
  const [top, second] = candidates;
  const margin = top && second ? top.riskScore - second.riskScore : 0;
  let score = 0.73;
  if (margin >= 4) score += 0.08;
  if ((top?.householdsSurveyed ?? 0) < 750 || (top?.womenInterviewed ?? 0) < 850) score -= 0.08;
  if ((top?.anaemia ?? 0) >= 75 && (top?.institutionalBirth ?? 100) >= 88) score -= 0.05;
  score = Math.max(0.45, Math.min(0.88, score));
  return {
    label: score >= 0.78 ? 'High' : score >= 0.64 ? 'Medium-high' : 'Medium',
    score: round(score, 2),
    summary:
      margin >= 4
        ? `The leading district is ${round(margin, 1)} risk-score points above the next candidate.`
        : `The top candidates are close; treat the ranking as a prioritization aid, not an absolute verdict.`,
  };
}

function buildRecommendation(candidates: CandidateRow[], overview: Record<string, unknown>, agentNarrative?: string | null) {
  const top = candidates[0];
  const confidence = confidenceFor(candidates);
  const citations = candidates.slice(0, 4).map((candidate, index) => ({
    recordId: candidate.recordId,
    table: NFHS_TABLE,
    primaryKey: {
      state_ut: candidate.state,
      district_name: candidate.district,
    },
    role: index === 0 ? 'selected district' : 'comparison district',
    metrics: {
      riskScore: candidate.riskScore,
      anaemiaPct: candidate.anaemia,
      institutionalBirthPct: candidate.institutionalBirth,
      sanitationPct: candidate.sanitation,
      cleanFuelPct: candidate.cleanFuel,
      womenLiteracyPct: candidate.womenLiteracy,
      householdsSurveyed: candidate.householdsSurveyed,
    },
  }));

  const uncertaintyFactors = [
    'NFHS-5 is district-level survey data, not a real-time caseload feed.',
    'Facilities and pincode tables were not synced because duplicate source keys violate direct Lakebase sync constraints.',
    'The score favors preventable maternal-health barriers; local partner capacity and transport constraints still need human review.',
  ];

  if ((top?.householdsSurveyed ?? 0) < 750) {
    uncertaintyFactors.unshift('The selected district has a smaller household survey base than nearby candidates.');
  }

  return {
    generatedAt: new Date().toISOString(),
    namedUser: 'Asha, District Program Lead at a public-health NGO',
    decision: "Which district should receive this week's limited maternal health outreach team?",
    beneficiary: 'Women and families in underserved districts who face higher anaemia and weaker birth-support conditions.',
    agent: {
      name: 'Asha Outreach Agent',
      endpoint: AGENT_ENDPOINT_NAME,
      mode: agentNarrative ? 'Databricks Model Serving synthesis + deterministic Lakebase evidence policy' : 'Deterministic Lakebase evidence policy; model synthesis unavailable',
    },
    recommendation: {
      district: top.district,
      state: top.state,
      action: `Commit this week's maternal health outreach team to ${top.district}, ${top.state}.`,
      rationale:
        agentNarrative ||
        `${top.district} has the highest combined maternal-health risk score among the current Lakebase candidates: high anaemia, weaker institutional-birth support, and household conditions that can compound outreach barriers.`,
      tradeoff:
        'This prioritizes concentrated maternal-health risk over serving the district with the single highest anaemia rate, because outreach capacity is limited and the selected district shows multiple compounding barriers.',
      confidence,
      riskScore: top.riskScore,
    },
    citations,
    alternatives: candidates.slice(1, 4),
    uncertaintyFactors,
    dataScope: {
      districts: toNumber(overview.district_count),
      states: toNumber(overview.state_count),
      averageAnaemiaPct: toNumber(overview.avg_anaemia),
      averageInstitutionalBirthPct: toNumber(overview.avg_institutional_birth),
    },
  };
}

function extractMessageContent(data: unknown) {
  const response = data as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String(part.text);
        return '';
      })
      .join(' ')
      .trim();
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return null;
}

async function ensureDecisionTable(appkit: AppKitWithLakebase) {
  await appkit.lakebase.query('CREATE SCHEMA IF NOT EXISTS app');
  await appkit.lakebase.query(`
    CREATE TABLE IF NOT EXISTS ${DECISIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decision_week TEXT NOT NULL,
      user_name TEXT NOT NULL,
      selected_state TEXT NOT NULL,
      selected_district TEXT NOT NULL,
      action TEXT NOT NULL,
      confidence_label TEXT NOT NULL,
      confidence_score DOUBLE PRECISION NOT NULL,
      risk_score DOUBLE PRECISION NOT NULL,
      citations JSONB NOT NULL,
      uncertainty JSONB NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed'
    )
  `);
}

async function loadOverview(appkit: AppKitWithLakebase) {
  const { rows } = await appkit.lakebase.query(`
    SELECT
      COUNT(*)::int AS district_count,
      COUNT(DISTINCT state_ut)::int AS state_count,
      ROUND(AVG(hh_improved_water_pct)::numeric, 1)::float AS avg_water,
      ROUND(AVG(hh_use_improved_sanitation_pct)::numeric, 1)::float AS avg_sanitation,
      ROUND(AVG(households_using_clean_fuel_for_cooking_pct)::numeric, 1)::float AS avg_clean_fuel,
      ROUND(AVG(institutional_birth_5y_pct)::numeric, 1)::float AS avg_institutional_birth,
      ROUND(AVG(women_age_15_49_who_are_literate_pct)::numeric, 1)::float AS avg_women_literacy,
      ROUND(AVG(all_w15_49_who_are_anaemic_pct)::numeric, 1)::float AS avg_anaemia
    FROM ${NFHS_TABLE}
  `);
  return serializeRows(rows)[0] ?? {};
}

async function loadCandidates(appkit: AppKitWithLakebase) {
  const { rows } = await appkit.lakebase.query(`
    SELECT
      state_ut,
      district_name,
      households_surveyed,
      women_15_49_interviewed,
      hh_improved_water_pct,
      hh_use_improved_sanitation_pct,
      households_using_clean_fuel_for_cooking_pct,
      institutional_birth_5y_pct,
      women_age_15_49_who_are_literate_pct,
      all_w15_49_who_are_anaemic_pct,
      (
        COALESCE(all_w15_49_who_are_anaemic_pct, 0) * 0.35 +
        (100 - COALESCE(institutional_birth_5y_pct, 100)) * 0.25 +
        (100 - COALESCE(hh_use_improved_sanitation_pct, 100)) * 0.2 +
        (100 - COALESCE(households_using_clean_fuel_for_cooking_pct, 100)) * 0.1 +
        (100 - COALESCE(women_age_15_49_who_are_literate_pct, 100)) * 0.1
      ) AS maternal_risk_score
    FROM ${NFHS_TABLE}
    WHERE all_w15_49_who_are_anaemic_pct IS NOT NULL
      AND institutional_birth_5y_pct IS NOT NULL
      AND hh_use_improved_sanitation_pct IS NOT NULL
      AND women_age_15_49_who_are_literate_pct IS NOT NULL
    ORDER BY maternal_risk_score DESC
    LIMIT 12
  `);
  return serializeRows(rows).map(mapCandidate);
}

async function synthesizeWithServing(appkit: AppKitWithLakebase, candidates: CandidateRow[]) {
  if (!appkit.serving) return null;
  const top = candidates[0];
  const prompt = [
    `You are Asha Outreach Agent for a public-health NGO.`,
    `Recommend the one district that should receive this week's limited maternal health outreach team.`,
    `Use only the supplied Lakebase evidence. Mention uncertainty honestly. Keep it to two sentences.`,
    `Selected by deterministic risk policy: ${top.district}, ${top.state}.`,
    `Evidence JSON: ${JSON.stringify(candidates.slice(0, 4))}`,
  ].join('\n');

  try {
    const result = await appkit.serving('agent').invoke({
      messages: [
        {
          role: 'system',
          content: 'Return concise operational recommendation prose. Do not invent records or metrics.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 220,
      temperature: 0.1,
    });
    if (!result.ok) return null;
    return extractMessageContent(result.data);
  } catch (err) {
    console.warn('Serving synthesis unavailable; using deterministic recommendation:', err);
    return null;
  }
}

async function loadRecommendation(appkit: AppKitWithLakebase) {
  const [overview, candidates] = await Promise.all([loadOverview(appkit), loadCandidates(appkit)]);
  const narrative = await synthesizeWithServing(appkit, candidates);
  return buildRecommendation(candidates, overview, narrative);
}

export async function setupHackEventRoutes(appkit: AppKitWithLakebase) {
  await ensureDecisionTable(appkit);

  appkit.server.extend((app) => {
    app.get('/api/hackevent/status', (_req, res) => {
      res.json(syncStatus);
    });

    app.get('/api/hackevent/overview', async (_req, res) => {
      try {
        res.json(await loadOverview(appkit));
      } catch (err) {
        console.error('Failed to load HackEvent overview:', err);
        res.status(503).json({
          error: 'Lakebase synced table is not readable yet',
          detail: err instanceof Error ? err.message : 'Unknown Lakebase error',
        });
      }
    });

    app.get('/api/hackevent/candidates', async (_req, res) => {
      try {
        res.json(await loadCandidates(appkit));
      } catch (err) {
        console.error('Failed to load HackEvent candidates:', err);
        res.status(503).json({
          error: 'Lakebase synced table is not readable yet',
          detail: err instanceof Error ? err.message : 'Unknown Lakebase error',
        });
      }
    });

    app.get('/api/hackevent/recommendation', async (_req, res) => {
      try {
        res.json(await loadRecommendation(appkit));
      } catch (err) {
        console.error('Failed to generate HackEvent recommendation:', err);
        res.status(503).json({
          error: 'Recommendation agent could not read Lakebase evidence',
          detail: err instanceof Error ? err.message : 'Unknown Lakebase error',
        });
      }
    });

    app.get('/api/hackevent/decisions', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(`
          SELECT
            id,
            created_at,
            decision_week,
            user_name,
            selected_state,
            selected_district,
            action,
            confidence_label,
            confidence_score,
            risk_score,
            citations,
            uncertainty,
            rationale,
            status
          FROM ${DECISIONS_TABLE}
          ORDER BY created_at DESC
          LIMIT 8
        `);
        res.json(serializeRows(rows));
      } catch (err) {
        console.error('Failed to load committed outreach decisions:', err);
        res.status(503).json({
          error: 'Committed decisions are not readable yet',
          detail: err instanceof Error ? err.message : 'Unknown Lakebase error',
        });
      }
    });

    app.post('/api/hackevent/decisions', async (req, res) => {
      try {
        const recommendation = req.body?.recommendation ? req.body : await loadRecommendation(appkit);
        const rec = recommendation.recommendation;
        const week =
          typeof req.body?.decisionWeek === 'string' && req.body.decisionWeek.trim()
            ? req.body.decisionWeek.trim()
            : new Date().toISOString().slice(0, 10);

        const { rows } = await appkit.lakebase.query(
          `
            INSERT INTO ${DECISIONS_TABLE} (
              decision_week,
              user_name,
              selected_state,
              selected_district,
              action,
              confidence_label,
              confidence_score,
              risk_score,
              citations,
              uncertainty,
              rationale
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
            RETURNING *
          `,
          [
            week,
            recommendation.namedUser,
            rec.state,
            rec.district,
            rec.action,
            rec.confidence.label,
            rec.confidence.score,
            rec.riskScore,
            JSON.stringify(recommendation.citations),
            JSON.stringify(recommendation.uncertaintyFactors),
            rec.rationale,
          ],
        );
        res.status(201).json(serializeRows(rows)[0]);
      } catch (err) {
        console.error('Failed to commit outreach decision:', err);
        res.status(503).json({
          error: 'Could not write the action record to Lakebase',
          detail: err instanceof Error ? err.message : 'Unknown Lakebase error',
        });
      }
    });
  });
}
