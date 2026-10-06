import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export function normalizeDates(value) {
  return clean(value).replace(/(\d{4})[.년/-]\s*(\d{1,2})[.월/-]\s*(\d{1,2})일?/g, (_, y, m, d) => y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0'))
    .replace(/(?<!\d)(\d{2})[./-](\d{2})[./-](\d{2})(?!\d)/g, (_, y, m, d) => '20' + y + '-' + m + '-' + d)
    .replace(/\[(\d{1,2}:\d{2})\]/g, '$1');
}
export function document(html) {
  const $ = load(html);
  $('script,style,noscript,svg,nav,header,footer').remove();
  return $;
}
export function fieldsFrom($, root) {
  const fields = {};
  root.find('tr').each((_, row) => {
    $(row).children('th').each((__, el) => {
      const key = clean($(el).text()).replace(/\s+/g, '');
      const value = clean($(el).next('td').text());
      if (key && value) fields[key] = value;
    });
  });
  root.find('dt').each((_, el) => {
    const key = clean($(el).text()).replace(/\s+/g, '');
    const value = clean($(el).next('dd').text());
    if (key && value) fields[key] = value;
  });
  return fields;
}
export function canonicalUrl(value) {
  const u = new URL(value);
  u.hash = '';
  u.pathname = u.pathname.replace(/;jsessionid=[^/;?]*/gi, '');
  for (const key of [...u.searchParams.keys()]) {
    if (/^(?:utm_.+|page|pageIndex|pageNo|pageNum|menuLevel|menuNo)$/i.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return u.href;
}
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const itemId = item => hash(String(item.sourceId) + ':' + canonicalUrl(item.url)).slice(0, 20);
export function revisionOf(item) {
  const detail = item.detail || {};
  return hash([item.sourceId, item.title, item.url && canonicalUrl(item.url), item.grade, item.days, item.applyRange,
    item.status, item.activityRange, item.place, item.cost, item.mode,
    ...['grade', 'days', 'applyRange', 'status', 'activityRange', 'place', 'cost', 'classTime',
      'requirements', 'skillDescription', 'difficulty', 'lessonInfo', 'prerequisites', 'selfPacedEvidence', 'closedEvidence',
      'requiredSchedule', 'sessions', 'contentText', 'attachments', 'evidence'].map(k => detail[k] ?? null)]);
}
export function profileHash(config) {
  return hash(Object.keys(config).sort().map(k => [k,config[k]]));
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
