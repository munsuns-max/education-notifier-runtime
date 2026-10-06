import {parseDateRange} from './conditions.mjs';
import {normalizeDates,canonicalUrl,hash} from './content.mjs';

export function openingCandidates(items,{now=new Date(),dateOnlyTime}={}) {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(dateOnlyTime || ''))throw new Error('날짜만 있는 신청 시작 알림 시각 미확정');
  const today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const selected=[],held=[];
  for(const item of items) {
    if(item.openingDateScope==='program-envelope' || item.detail?.openingDateScope==='program-envelope') {
      held.push({id:item.id,reason:'프로그램 전체 운영 기간만 확인: 개별 회차 신청 시작일 미검증'});continue;
    }
    const detailRange=normalizeDates(item.detail?.applyRange),listRange=normalizeDates(item.applyRange);
    let dates=parseDateRange(detailRange || listRange);
    if(dates.length!==2 || dates.some(d=>!d.valid) || dates[0].ms>dates[1].ms) {
      held.push({id:item.id,reason:'신청 시작·마감 날짜 미확정'});continue;
    }
    if(detailRange && listRange) {
      const listDates=parseDateRange(listRange);
      if(listDates.length===2 && listDates.every(d=>d.valid) && listDates.some((d,n)=>d.date!==dates[n].date || d.hasTime&&dates[n].hasTime&&d.ms!==dates[n].ms)) {
        held.push({id:item.id,reason:'목록·상세 신청 기간 불일치'});continue;
      }
      // Preserve explicit official times when a detail page omits them.
      if(listDates.length===2 && listDates.every(d=>d.valid))dates=dates.map((d,n)=>!d.hasTime && listDates[n].hasTime?listDates[n]:d);
    }
    const [start,end]=dates;
    if(start.date!==today)continue;
    const due=start.hasTime?start.ms:Date.parse(`${start.date}T${dateOnlyTime}:00+09:00`);
    if(now.getTime()<due || (end.hasTime?now.getTime()>=end.ms:today>end.date))continue;
    if(!item.url || /접수\s*마감|모집\s*마감|신청\s*마감|접수\s*종료|모집\s*종료|예약\s*종료|정원\s*마감/.test(item.detail?.status || item.status || ''))continue;
    const eventKey=hash([canonicalUrl(item.url),start.date,start.hasTime?start.ms:'date-only']).slice(0,24);
    selected.push({...item,id:`opening-${eventKey}`,opening:{date:start.date,hasTime:start.hasTime,dueAt:new Date(due).toISOString()}});
  }
  return {items:selected,held};
}
