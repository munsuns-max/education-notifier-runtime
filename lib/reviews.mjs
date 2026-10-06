import { canonicalUrl, revisionOf, profileHash } from './content.mjs';
export function applyReviews(item, config, records, now = new Date()) {
  const evaluation = structuredClone(item.evaluation);
  if (item.detail?.error || !item.checkedAt || !item.detail?.checkedAt) return evaluation;
  for (const r of records) {
    if (!r.url || canonicalUrl(r.url)!==canonicalUrl(item.url) || r.revision!==revisionOf(item) || r.profile!==profileHash(config)) continue;
    const checked=Date.parse(r.checkedAt),expires=Date.parse(r.expiresAt);
    if (!Number.isFinite(checked) || !Number.isFinite(expires) || checked>now.getTime() || expires<=now.getTime() || expires<=checked || !r.evidence?.trim()) continue;
    // Exclusions and freshness/failed parsing can never be overridden.
    if (evaluation.checks[r.check]?.state !== 'review' || ['freshness','link'].includes(r.check)) continue;
    evaluation.checks[r.check]={state:'pass',reason:'수동 근거 확인',evidence:r.evidence,checkedAt:r.checkedAt,expiresAt:r.expiresAt};
  }
  const checks=Object.values(evaluation.checks);
  evaluation.state=checks.some(c=>c.state==='exclude')?'excluded':checks.some(c=>c.state==='review')?'review':'recommended';
  evaluation.reasons=checks.filter(c=>c.state!=='pass').map(c=>c.reason);
  return evaluation;
}
