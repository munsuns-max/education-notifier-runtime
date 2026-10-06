import { load } from 'cheerio';
import { allowedUrl } from './http.mjs';
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export function parseBoard(html, source, checkedAt, pageUrl = source.url) {
  const $ = load(html), items = [];
  $('tr').each((_, row) => {
    const values = {};
    $(row).find('td[data-th]').each((_, cell) => { values[$(cell).attr('data-th')] = clean($(cell).text()); });
    if (!values['프로그램명']) return;
    const href = $(row).find('a.btn4[href]').first().attr('href');
    const url = href ? allowedUrl(href, source, pageUrl) : null;
    items.push({ title: values['프로그램명'], url, source: source.name, sourceId: source.id, engine: 'official',
      summary: values['영역/주제'] || '', grade: values['모집대상'] || '', days: values['수업요일'] || '',
      applyRange: values['수강신청기간'] || '', status: values['모집상태'] || '',
      activityRange: values['수업기간'] || '', place: values['수업장소(상세)'] || '',
      cost: values['참가비'] || values['수강료'] || '', checkedAt, evidence: values });
  });
  return items;
}

export function parseDetail(html) {
  const $ = load(html), fields = {};
  $('script,style,noscript,nav,header,footer').remove();
  const accepted = /^(수업시간|수업요일|수업기간|모집대상|수강가능학년|수강신청기간|모집상태|참가비|수강료|교육비|재료비|신청자격|지원자격|필요실력|필수일정|프로그램특징|프로그램운영요청사항)$/;
  function readValue(cell) {
    const checkboxes = cell.find('input[type="checkbox"]');
    if (checkboxes.length) {
      const day = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
      return checkboxes.filter('[checked]').toArray().map(e => day[$(e).attr('value')] || clean($(e).attr('value'))).join(', ');
    }
    const mobile = cell.find('.mobile-range-field').first();
    if (mobile.length) return clean(mobile.text());
    const inputs = cell.find('input:not([type="hidden"]):not([type="button"]):not([type="submit"]),textarea');
    if (inputs.length) return inputs.toArray().map(e => clean($(e).val())).filter(Boolean).join(' ~ ');
    return clean(cell.text());
  }
  $('td[data-th]').each((_, cell) => {
    const label = clean($(cell).attr('data-th')).replace(/\s+/g, '');
    if (!accepted.test(label)) return;
    const value = readValue($(cell));
    if (value) fields[label] = value;
  });
  // 값은 명시된 라벨에서만 읽고 페이지 전체의 안내 문구를 참가 조건으로 사용하지 않는다.
  $('strong,dt,th').each((_, el) => {
    const label = clean($(el).text()).replace(/[:：]$/, '').replace(/\s+/g, '');
    if (!accepted.test(label) || fields[label]) return;
    const tag = el.tagName;
    let value;
    if (tag === 'dt' || tag === 'th') value = readValue($(el).next());
    else {
      const parts = [];
      let next = el.nextSibling;
      while (next && !['strong', 'dt', 'th'].includes(next.tagName)) {
        parts.push(next.type === 'text' ? next.data : $(next).text()); next = next.nextSibling;
      }
      value = clean(parts.join(' '));
    }
    if (value) fields[label] = value;
  });
  const sessions = [];
  $('td[data-th]').each((_, cell) => {
    if (clean($(cell).attr('data-th')) !== '수업일') return;
    const date = readValue($(cell));
    if (date) sessions.push(date);
  });
  return { classTime: fields['수업시간'], days: fields['수업요일'], grade: fields['모집대상'],
    applyRange: fields['수강신청기간'], status: fields['모집상태'], activityRange: fields['수업기간'],
    cost: [fields['참가비'], fields['수강료'], fields['교육비'], fields['재료비'] && `재료비 ${fields['재료비']}`].filter(Boolean).join('; '),
    requirements: [fields['신청자격'], fields['지원자격'], fields['필요실력'],
      fields['수강가능학년'] && `상세 수강가능 학년 표기: ${fields['수강가능학년']}`, fields['프로그램운영요청사항']].filter(Boolean).join('; '),
    skillDescription: fields['프로그램특징'], sessions,
    requiredSchedule: fields['필수일정'], evidence: { ...fields, 차시별수업일: sessions } };
}
