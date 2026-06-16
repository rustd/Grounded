import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
} from '@databricks/appkit-ui/react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface Citation {
  recordId: string;
  table: string;
  primaryKey: {
    state_ut: string;
    district_name: string;
  };
  role: string;
  metrics: {
    riskScore: number;
    anaemiaPct: number | null;
    institutionalBirthPct: number | null;
    sanitationPct: number | null;
    cleanFuelPct: number | null;
    womenLiteracyPct: number | null;
    householdsSurveyed: number | null;
  };
}

interface Candidate {
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

interface RecommendationResponse {
  generatedAt: string;
  namedUser: string;
  decision: string;
  beneficiary: string;
  agent: {
    name: string;
    endpoint: string;
    mode: string;
  };
  recommendation: {
    district: string;
    state: string;
    action: string;
    rationale: string;
    tradeoff: string;
    confidence: {
      label: string;
      score: number;
      summary: string;
    };
    riskScore: number;
  };
  citations: Citation[];
  alternatives: Candidate[];
  uncertaintyFactors: string[];
  dataScope: {
    districts: number | null;
    states: number | null;
    averageAnaemiaPct: number | null;
    averageInstitutionalBirthPct: number | null;
  };
}

interface DecisionRecord {
  id: string;
  created_at: string;
  decision_week: string;
  user_name: string;
  selected_state: string;
  selected_district: string;
  action: string;
  confidence_label: string;
  confidence_score: number;
  risk_score: number;
  citations: Citation[];
  uncertainty: string[];
  rationale: string;
  status: string;
}

interface SyncTable {
  name: string;
  status: string;
  detail: string;
}

interface SyncStatus {
  mode: string;
  source: string;
  lakebaseCatalog: string;
  onlineTable: string;
  syncedTables: SyncTable[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return `${Number(value).toFixed(1)}%`;
}

function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return Intl.NumberFormat().format(Math.round(Number(value)));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function LakebasePage() {
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [latestCommitId, setLatestCommitId] = useState<string | null>(null);

  const loadOperationalLoop = async (quiet = false) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [statusResponse, recommendationResponse, decisionsResponse] = await Promise.all([
        getJson<SyncStatus>('/api/hackevent/status'),
        getJson<RecommendationResponse>('/api/hackevent/recommendation'),
        getJson<DecisionRecord[]>('/api/hackevent/decisions'),
      ]);
      setStatus(statusResponse);
      setRecommendation(recommendationResponse);
      setDecisions(decisionsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operational loop');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadOperationalLoop(false);
  }, []);

  const commitRecommendation = async () => {
    if (!recommendation) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const committed = await postJson<DecisionRecord>('/api/hackevent/decisions', recommendation);
      setLatestCommitId(String(committed.id));
      const updated = await getJson<DecisionRecord[]>('/api/hackevent/decisions');
      setDecisions(updated);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Unable to commit recommendation');
    } finally {
      setCommitting(false);
    }
  };

  const confidencePercent = Math.round((recommendation?.recommendation.confidence.score ?? 0) * 100);
  const selectedCitation = recommendation?.citations[0];
  const committedLatest = useMemo(() => decisions[0] ?? null, [decisions]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="border-b pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">Lakebase live read</Badge>
          <Badge variant="outline">Agent Bricks recommendation</Badge>
          <Badge variant="outline">Human write-back loop</Badge>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-normal text-[#0B2026] md:text-4xl">
              Maternal outreach decision cockpit
            </h2>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <DecisionFact label="Named user" value={recommendation?.namedUser ?? 'Asha, District Program Lead at a public-health NGO'} />
              <DecisionFact label="Recurring decision" value={recommendation?.decision ?? "Which district should receive this week's limited maternal health outreach team?"} />
            </div>
            <p className="max-w-4xl text-base leading-7 text-muted-foreground">
              Beneficiary: {recommendation?.beneficiary ?? 'Women and families in underserved districts.'}
            </p>
          </div>

          <div className="border border-[#0B2026]/15 bg-[#F9F7F4] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0B2026]">
              <Database className="h-4 w-4 text-[#FF3621]" />
              Live data scope
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Metric label="Districts" value={formatCount(recommendation?.dataScope.districts)} />
              <Metric label="States/UTs" value={formatCount(recommendation?.dataScope.states)} />
              <Metric label="Avg anaemia" value={formatPercent(recommendation?.dataScope.averageAnaemiaPct)} />
              <Metric label="Avg inst. births" value={formatPercent(recommendation?.dataScope.averageInstitutionalBirthPct)} />
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">The operational loop is not ready</div>
            <div className="mt-1 text-destructive/80">{error}</div>
          </div>
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden border-[#0B2026]/15">
            <CardHeader className="border-b bg-[#0B2026] text-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Sparkles className="h-5 w-5 text-[#FF3621]" />
                  Agent recommendation
                </CardTitle>
                <Button variant="secondary" size="sm" onClick={() => void loadOperationalLoop(true)} disabled={refreshing}>
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-9 w-3/4" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : recommendation ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Recommended district</div>
                      <div className="mt-1 text-3xl font-semibold text-[#0B2026]">
                        {recommendation.recommendation.district}, {recommendation.recommendation.state}
                      </div>
                    </div>
                    <div className="min-w-48 border border-[#FF3621]/35 bg-[#FF3621]/10 p-3">
                      <div className="text-xs font-medium uppercase text-[#0B2026]/70">Confidence</div>
                      <div className="mt-1 flex items-end gap-2">
                        <span className="text-2xl font-semibold text-[#0B2026]">{recommendation.recommendation.confidence.label}</span>
                        <span className="pb-1 text-sm text-muted-foreground">{confidencePercent}%</span>
                      </div>
                      <Progress value={confidencePercent} className="mt-3 h-2 bg-white" />
                    </div>
                  </div>

                  <div className="border-l-4 border-[#FF3621] bg-[#F9F7F4] p-4">
                    <p className="text-base leading-7 text-[#0B2026]">{recommendation.recommendation.rationale}</p>
                    <p className="mt-3 text-sm leading-6 text-[#0B2026]/75">{recommendation.recommendation.tradeoff}</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <Metric label="Risk score" value={recommendation.recommendation.riskScore.toFixed(1)} />
                    <Metric label="Anaemia" value={formatPercent(selectedCitation?.metrics.anaemiaPct)} />
                    <Metric label="Institutional births" value={formatPercent(selectedCitation?.metrics.institutionalBirthPct)} />
                  </div>

                  <div className="rounded-none border border-[#0B2026]/15 bg-white p-4">
                    <div className="flex items-center gap-2 font-semibold text-[#0B2026]">
                      <AlertTriangle className="h-4 w-4 text-[#FF3621]" />
                      Uncertainty handled honestly
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{recommendation.recommendation.confidence.summary}</p>
                    <ul className="mt-3 space-y-2 text-sm text-[#0B2026]">
                      {recommendation.uncertaintyFactors.map((factor) => (
                        <li key={factor} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#FF3621]" />
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <EmptyState title="No recommendation yet" detail="Lakebase did not return enough evidence to rank districts." />
              )}
            </CardContent>
          </Card>

          <Card className="border-[#0B2026]/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-[#FF3621]" />
                Based on these records
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-20 w-full" />
                  ))}
                </div>
              ) : recommendation?.citations.length ? (
                <div className="grid gap-3">
                  {recommendation.citations.map((citation) => (
                    <div key={citation.recordId} className="border border-[#0B2026]/15 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#0B2026]">
                            {citation.primaryKey.district_name}, {citation.primaryKey.state_ut}
                          </div>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">{citation.recordId}</div>
                        </div>
                        <Badge variant={citation.role === 'selected district' ? 'default' : 'secondary'}>{citation.role}</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                        <Metric label="Risk" value={citation.metrics.riskScore.toFixed(1)} compact />
                        <Metric label="Anaemia" value={formatPercent(citation.metrics.anaemiaPct)} compact />
                        <Metric label="Inst. birth" value={formatPercent(citation.metrics.institutionalBirthPct)} compact />
                        <Metric label="Sanitation" value={formatPercent(citation.metrics.sanitationPct)} compact />
                        <Metric label="Clean fuel" value={formatPercent(citation.metrics.cleanFuelPct)} compact />
                        <Metric label="Surveyed" value={formatCount(citation.metrics.householdsSurveyed)} compact />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No citations" detail="The agent will not recommend without source rows." />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-[#FF3621]/30 bg-[#F9F7F4]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-[#FF3621]" />
                Commit action record
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-[#0B2026]/75">
                Committing writes the recommended outreach decision into Lakebase table{' '}
                <span className="font-mono text-[#0B2026]">app.outreach_decisions</span>.
              </p>
              <Button
                className="h-12 w-full bg-[#FF3621] text-white hover:bg-[#d72d1b]"
                disabled={!recommendation || committing}
                onClick={() => void commitRecommendation()}
              >
                <ClipboardCheck className="h-5 w-5" />
                {committing ? 'Committing to Lakebase...' : 'Commit this outreach decision'}
              </Button>
              {commitError && <div className="text-sm text-destructive">{commitError}</div>}
              {committedLatest && (
                <div className="border border-[#0B2026]/15 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#0B2026]">
                    <CheckCircle2 className="h-4 w-4 text-[#FF3621]" />
                    Latest written-back record
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="font-semibold">
                      #{committedLatest.id} · {committedLatest.selected_district}, {committedLatest.selected_state}
                    </div>
                    <div className="text-muted-foreground">{formatDateTime(committedLatest.created_at)}</div>
                    <div className="text-[#0B2026]/80">{committedLatest.action}</div>
                    {String(committedLatest.id) === latestCommitId && (
                      <Badge variant="default" className="mt-1">Just committed</Badge>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#0B2026]/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-[#FF3621]" />
                Next-best alternatives
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-20 w-full" />
                  ))}
                </div>
              ) : recommendation?.alternatives.length ? (
                <div className="space-y-3">
                  {recommendation.alternatives.map((candidate, index) => (
                    <div key={candidate.recordId} className="border border-[#0B2026]/15 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase text-muted-foreground">Rank {index + 2}</div>
                          <div className="font-semibold text-[#0B2026]">
                            {candidate.district}, {candidate.state}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Risk</div>
                          <div className="font-semibold">{candidate.riskScore.toFixed(1)}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <Metric label="Anaemia" value={formatPercent(candidate.anaemia)} compact />
                        <Metric label="Sanitation" value={formatPercent(candidate.sanitation)} compact />
                        <Metric label="Inst. birth" value={formatPercent(candidate.institutionalBirth)} compact />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No alternatives" detail="The candidate ranking has not loaded yet." />
              )}
            </CardContent>
          </Card>

          <Card className="border-[#0B2026]/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-[#FF3621]" />
                Sync and resource state
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(status?.syncedTables ?? []).map((table) => (
                  <div key={table.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[#0B2026]">{table.name}</div>
                      <div className="text-xs leading-5 text-muted-foreground">{table.detail}</div>
                    </div>
                    <Badge variant={table.status === 'configured' ? 'default' : 'secondary'}>{table.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function DecisionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#0B2026]/15 bg-white p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 text-base font-semibold leading-6 text-[#0B2026]">{value}</div>
    </div>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={compact ? 'min-w-0' : 'border border-[#0B2026]/10 bg-white p-3'}>
      <div className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className={compact ? 'mt-1 font-semibold text-[#0B2026]' : 'mt-1 text-xl font-semibold text-[#0B2026]'}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border border-dashed border-[#0B2026]/20 p-8 text-center">
      <div className="font-semibold text-[#0B2026]">{title}</div>
      <div className="mt-2 text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}
