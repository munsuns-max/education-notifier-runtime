const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const result = (state, reason, evidence) => ({ state, reason, evidence: clean(evidence) });
const gradeOffset = { 초: 0, 중: 6, 고: 9 };
function compatibleDates(a,b) {
  const x=parseDateRange(a),y=parseDateRange(b);
  return x.length===2 && y.length===2 && x.every((d,n)=>d.valid && y[n].valid && d.date===y[n].date && (!d.hasTime || !y[n].hasTime || d.ms===y[n].ms));
}

export function gradeCondition(value, target = 9) {
  const raw = clean(value);
  if (!raw) return result('review', '모집 대상 미확인', raw);
  const text = raw.replace(/초등학교|초등학생|초등/g, '초').replace(/중학교|중학생|중등/g, '중')
    .replace(/고등학교|고등학생|고등/g, '고').replace(/\s+/g, '').replace(/전학년|전체학년/g, '전체').replace(/학년/g, '')
    .replace(/중[·ㆍ/]?고생|중고/g, '중,고');
  // 학교·지역·나이·제외 조항은 학년 범위만으로 확정하지 않는다.
  const restricted = /제외|미만|초과|이상|이하|만\d|세|학교재학|거주|소재|선발|추천/.test(text);
  const ranges = [];
  let rest = text.replace(/([초중고])([1-6])([~～〜–—-])([초중고])?([1-6])/g,
    (match, a, n, separator, b, m) => {
      const endStage = b || a;
      if (Number(n) > (a === '초' ? 6 : 3) || Number(m) > (endStage === '초' ? 6 : 3)) return match;
      ranges.push([gradeOffset[a] + Number(n), gradeOffset[endStage] + Number(m)]);
      return '|';
    });
  rest = rest.replace(/([초중고])([1-6](?:[,·ㆍ/]\d)*)/g, (match, stage, numbers) => {
    const ns = numbers.split(/[,·ㆍ/]/).map(Number);
    if (ns.some(n => n > (stage === '초' ? 6 : 3))) return match;
    ranges.push(...ns.map(n => [gradeOffset[stage] + n, gradeOffset[stage] + n]));
    return '|';
  });
  let broad = false;
  rest = rest.replace(/(^|[|,·ㆍ/및과와()])([초중고])(?:학생|전체|모두|대상|누구나|만)?(?=$|[|,·ㆍ/및과와()])/g,
    (_, separator, stage) => {
      const start = gradeOffset[stage] + 1, end = gradeOffset[stage] + (stage === '초' ? 6 : 3);
      if (start <= target && target <= end) broad = true;
      ranges.push([start, end]);
      return `${separator}|`;
    });
  const includes = broad || ranges.some(([a, b]) => a <= target && target <= b);
  const ambiguous = ranges.some(([a, b]) => a > b) || /[^|,·ㆍ/및과와()]/.test(rest);
  if (restricted || ambiguous) return result('review', '학년 외 제한 또는 대상 문구 해석 확인', raw);
  if (includes) return result('pass', '중3을 포함하는 모집 대상', raw);
  if (ranges.length
      || /초등학생만|고등학생만|성인만|대학생만/.test(raw)) return result('exclude', '중3을 포함하지 않는 모집 대상', raw);
  return result('review', '구체적인 학년·나이 자격 확인 필요', raw);
}

export function scheduleCondition(value) {
  const raw = clean(value);
  if (!raw) return result('review', '필수 수업 요일 미확인', raw);
  // 자유 수강이라도 별도의 실시간·평일 필수 일정은 확인해야 한다.
  if (/선택|협의|가능|자율|상시/.test(raw)) return result('review', '선택 일정과 필수 실시간 일정 확인', raw);
  let text = raw.replace(/\d{1,2}:\d{2}(?:\s*[~～〜–—-]\s*\d{1,2}:\d{2})?/g, '')
    .replace(/\d+\s*회차/g, '')
    .replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[/.]\d{1,2}/g, '')
    .replace(/요일|매주|주마다|수업|필수|실시간|온라인|오프라인|일정|[\s()\[\]:：]/g, '')
    .replace(/주말/g, '토,일').replace(/평일/g, '월~금');
  text = text.replace(/([월화수목금토일])[~～〜–—-]([월화수목금토일])/g, (_, a, b) => {
    const week = '월화수목금토일', start = week.indexOf(a), end = week.indexOf(b);
    return start <= end ? week.slice(start, end + 1).split('').join(',') : '?';
  });
  if (!/^[월화수목금토일,·ㆍ/및과와]+$/.test(text)) return result('review', '요일 문구 또는 날짜별 필수 일정 확인', raw);
  if (/[월화수목금]/.test(text)) return result('exclude', '필수 평일 수업이 포함됨', raw);
  return result('pass', '표시된 수업 요일은 주말', raw);
}

export function parseDateRange(value) {
  const matches = [...clean(value).matchAll(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/g)];
  return matches.map(m => {
    const [, year, month, day, hour, minute, second] = m;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const time = `${(hour || '00').padStart(2, '0')}:${minute || '00'}:${second || '00'}`;
    const ms = Date.parse(`${date}T${time}+09:00`);
    const valid = Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31
      && Number(hour || 0) <= 23 && Number(minute || 0) <= 59 && Number(second || 0) <= 59
      && Number.isFinite(ms) && new Date(ms + 9 * 3600000).toISOString().slice(0, 10) === date;
    return { date, ms, hasTime: hour !== undefined, valid };
  });
}

export function applicationCondition(range, status, now = new Date()) {
  const evidence = `${range || ''} | ${status || ''}`;
  if (/접수\s*마감|모집\s*마감|신청\s*마감|모집\s*완료|접수\s*종료|정원\s*마감|선착순\s*(?:종료|마감)/.test(status || ''))
    return result('exclude', '모집이 마감됨', evidence);
  const dates = parseDateRange(range);
  if (dates.length !== 2 || dates.some(d => !d.valid) || dates[0].ms > dates[1].ms)
    return result('review', '신청 시작·마감 날짜 해석 확인', evidence);
  const [start, end] = dates;
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  if (end.hasTime ? now.getTime() >= end.ms : today > end.date) return result('exclude', '신청 마감이 지남', evidence);
  if (start.hasTime ? now.getTime() < start.ms : today < start.date) return result('review', '신청 시작 전', evidence);
  if (!start.hasTime || !end.hasTime) return result('review', '신청 시각 미확인', evidence);
  if (!/접수\s*중|모집\s*중|신청\s*가능/.test(status || '')) return result('review', '현재 모집 상태 확인 필요', evidence);
  return result('pass', '신청 기간 내이며 접수중', evidence);
}

export function costCondition(value, maxCost = 30000) {
  const raw = clean(value);
  if (!raw) return result('review', '참가비·재료비·과정 총액 미확인', raw);
  const amounts = [...raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(만\s*)?원/g)]
    .map(m => Number(m[1].replaceAll(',', '')) * (m[2] ? 10000 : 1));
  if (/별도|추가|회당|1회|월|예정|문의|부터|~/.test(raw)) return result('review', '전체 과정 비용과 추가 비용 확인', raw);
  if (!/총액|총\s*비용|전체\s*과정|전액|재료비\s*포함/.test(raw)) return result('review', '재료비를 포함한 전체 비용인지 확인', raw);
  if (amounts.length === 1) return result(amounts[0] > maxCost ? 'exclude' : 'pass',
    amounts[0] > maxCost ? `전체 비용이 ${maxCost.toLocaleString('ko-KR')}원 상한 초과` : '표시된 전체 비용은 예산 내', raw);
  if (amounts.length === 0 && /무료|없음|없습니다/.test(raw)) return result('pass', '전체 비용 무료 명시', raw);
  return result('review', '비용 합계 또는 지원 조건 확인', raw);
}

export function classTimeCondition(value) {
  const raw = clean(value);
  const match = /^(\d{1,2}):(\d{2})\s*[~～〜–—-]\s*(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return result('review', '회당 시작·종료 시각 확인', raw);
  const [, h1, m1, h2, m2] = match.map(Number);
  if ([h1, h2].some(h => h > 23) || [m1, m2].some(m => m > 59) || h1 * 60 + m1 >= h2 * 60 + m2)
    return result('review', '수업 시각 오류 또는 익일 종료 여부 확인', raw);
  return result('pass', '회당 시작·종료 시각이 표시됨', raw);
}

export function evaluate(item, config = {}, now = new Date()) {
  const target = clean(config.schoolYear || '중학교 3학년');
  if (!/^중(?:학교)?\s*3(?:학년)?$/.test(target)) throw new Error('현재 지원하는 학년 설정은 중학교 3학년입니다.');
  const detail = item.detail || {};
  const checks = {
    grade: gradeCondition(item.grade), schedule: scheduleCondition(item.days),
    application: applicationCondition(item.applyRange, item.status, now),
    cost: costCondition(detail.cost || item.cost, config.maxCostWon ?? 30000),
    classTime: classTimeCondition(detail.classTime || item.classTime)
  };
  const conflicts = [];
  for (const [field, fn] of [['grade', gradeCondition], ['days', scheduleCondition], ['applyRange', v => applicationCondition(v, detail.status || item.status, now)]]) {
    if (!detail[field]) continue;
    const key = { grade: 'grade', days: 'schedule', applyRange: 'application' }[field];
    const other = fn(detail[field]);
    if (item[field] && clean(item[field]) !== clean(detail[field])
        && (field === 'applyRange' ? !compatibleDates(item[field],detail[field]) : other.state !== checks[key].state)
        && !(other.state === 'exclude' && checks[key].state === 'exclude')) {
      conflicts.push(`목록·상세의 ${field === 'grade' ? '대상' : field === 'days' ? '요일' : '신청기간'} 충돌`);
      checks[key] = result('review', conflicts.at(-1), `${item[field]} / ${detail[field]}`);
    } else checks[key] = other;
  }
  if (detail.status && detail.status !== item.status) {
    const other = applicationCondition(detail.applyRange || item.applyRange, detail.status, now);
    if (other.state !== checks.application.state) checks.application = result('review', '목록·상세 모집 상태 충돌', `${item.status} / ${detail.status}`);
  }
  if (detail.cost && item.cost && clean(detail.cost) !== clean(item.cost)) checks.cost = result('review', '목록·상세 비용 대조 필요', `${item.cost} / ${detail.cost}`);
  const activityRange = item.activityRange || detail.activityRange;
  const dates = parseDateRange(activityRange);
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  checks.activity = dates.length === 2 && dates.every(d => d.valid) && dates[0].ms <= dates[1].ms
    ? result(dates[1].date < today ? 'exclude' : 'pass', dates[1].date < today ? '활동 기간이 종료됨' : '활동 기간이 남아 있음', activityRange)
    : result('review', '활동 기간 확인 필요', activityRange);
  if (item.activityRange && detail.activityRange && clean(detail.activityRange) !== clean(item.activityRange)) conflicts.push('목록·상세의 활동 기간 충돌');
  if (/일정|운영일|수업일|기간|날짜/.test(item.title) && /변경/.test(item.title)) conflicts.push('제목의 일정 변경 안내와 목록·상세 일정 대조 필요');
  if (conflicts.length && checks.activity.state !== 'exclude') checks.activity = result('review', conflicts.join('; '), `${item.title} / ${item.activityRange} / ${detail.activityRange || ''}`);
  checks.detail = result('review', detail.error ? `상세 수집 실패: ${detail.error}` : '개인 신청·지역·학교·나이 제한과 필요 실력 확인', detail.requirements || item.grade);
  const applicantText=clean(`${detail.grade || item.grade || ''}; ${detail.requirements || ''}`);
  const optionalGroup=/개인\s*(?:신청|접수)\s*(?:가능|및|또는)|개인\s*(?:및|또는|·|,|\/)\s*단체|단체\s*(?:신청|접수)\s*(?:가능|선택|불가|금지)/.test(applicantText);
  if(!optionalGroup && /단체\s*(?:접수|신청)|^(?:학교 및 청소년기관|청소년기관 및 청소년 단체)(?:;|$)/.test(applicantText))
    checks.individualApplication=result('exclude','개인 신청 대상이 아닌 단체·기관 과정',applicantText);
  else if(optionalGroup && /단체/.test(applicantText))
    checks.individualApplication=result('review','개인·단체 신청 방식과 최소 인원 확인',applicantText);
  if (!item.url) checks.link = result('review', '허용된 공식 상세 링크 미확인', '');
  if (detail.requiredSchedule) checks.requiredSchedule = scheduleCondition(detail.requiredSchedule);
  if (detail.sessions?.length) {
    const sessionDates = detail.sessions.map(date => parseDateRange(date));
    const valid = sessionDates.every(values => values.length === 1 && values[0].valid);
    if (!valid) checks.sessions = result('review', '차시별 수업일 해석 확인', detail.sessions.join(', '));
    else {
      const weekday = sessionDates.some(([date]) => ![0, 6].includes(new Date(`${date.date}T12:00:00+09:00`).getUTCDay()));
      checks.sessions = result(weekday ? 'exclude' : 'pass', weekday ? '차시별 수업일에 필수 평일 일정이 포함됨' : '표시된 차시별 수업일은 주말', detail.sessions.join(', '));
      if (dates.length === 2 && dates.every(d => d.valid)
          && sessionDates.some(([date]) => date.date < dates[0].date || date.date > dates[1].date))
        checks.activity = result('review', '차시별 수업일이 목록의 활동 기간 밖에 있음', `${item.activityRange} / ${detail.sessions.join(', ')}`);
    }
  }
  checks.travel = result('review', /온라인/.test(item.place || '') ? '온라인 과정의 필수 방문 여부 확인' : '실제 대중교통 편도 시간 확인 필요', item.place);
  const body = `${detail.requirements || ''} ${detail.contentText || ''}`;
  const extraCost = body.match(/(?:재료비|교재비|준비물|식비|보험료|별도\s*비용|추가\s*비용)[^.\n]{0,65}/);
  if (extraCost && checks.cost.state === 'pass') checks.cost = result('review', '본문의 추가 비용·준비물과 과정 총액 대조 필요', extraCost[0]);
  const eligibility = body.match(/(?:학교장\s*추천|학교\s*단위\s*신청|단체\s*신청|(?:거주|재학|소재)\s*(?:자|학생|학교)?\s*한정|만\s*\d{1,2}\s*세|선수\s*(?:학습|지식)|사전\s*경험)[^.\n]{0,65}/);
  if (eligibility) checks.eligibilityText = result('review', '본문의 개인 자격·나이·학교·선행 실력 확인', eligibility[0]);
  const mandatory = body.match(/(?:필수\s*(?:참석|출석|방문|대면|실시간)|매주\s*[월화수목금]|오프라인\s*(?:참석|수업)|현장\s*(?:참석|방문))[^.\n]{0,65}/);
  if (mandatory) checks.mandatoryText = result('review', '본문의 필수 실시간·방문 일정 확인', mandatory[0]);
  if (item.mode === 'self-paced') {
    if (!item.days && !detail.days) checks.schedule = result('review', '자율 강좌의 필수 실시간 일정 유무 확인', detail.requiredSchedule);
    if (!detail.classTime && !item.classTime) checks.classTime = result('pass', '자율 강좌: 고정 회당 시각 적용 안 함', item.mode);
    if (/신청일로부터\s*\d+일/.test(activityRange || '') && !conflicts.length) checks.activity = result('pass', '신청일 기준 자율 수강 기간', activityRange);
    if (!item.applyRange && !detail.applyRange) checks.application = result('review', '상시 강좌의 현재 수강 가능 여부 확인', item.status);
    if(detail.selfPacedEvidence && !item.days && !detail.days && !detail.requiredSchedule && !detail.sessions?.length && !mandatory)
      checks.schedule=result('pass','공식 상세에 고정 일정 없이 자유 수강 명시',detail.selfPacedEvidence);
  }
  const closedTitle=clean(item.title).match(/[([{【]\s*(?:접수\s*|모집\s*|신청\s*|선착순\s*)?마감(?:\s*완료)?\s*[)\]}】]/)?.[0];
  if(closedTitle || detail.closedEvidence) {
    const reopening=/재모집|추가\s*모집|모집\s*재개|접수\s*재개|(?:모집|접수|신청)\s*기간\s*연장/.test(item.title || '');
    const currentOpen=/접수\s*중|모집\s*중|신청\s*가능/.test(detail.status || item.status || '');
    checks.closure=result(reopening || currentOpen?'review':'exclude',reopening || currentOpen?'마감 안내와 현재 모집 표기 대조 필요':'제목·공고 본문에 접수 마감 명시',detail.closedEvidence || closedTitle);
  }
  if (/결과\s*발표|합격자|선정\s*결과|당첨자|휴관\s*안내/.test(item.title)) checks.notice = result('exclude', '모집이 아닌 결과·운영 안내', item.title);
  if (detail.attachments?.length) checks.attachments = result('review', '이미지·첨부 자료의 추가 자격·일정 확인', detail.attachments.map(a=>a.url).join(', '));
  const all = Object.values(checks);
  return { state: all.some(c => c.state === 'exclude') ? 'excluded' : all.some(c => c.state === 'review') ? 'review' : 'recommended',
    checks, reasons: all.filter(c => c.state !== 'pass').map(c => c.reason), checkedAt: now.toISOString() };
}
