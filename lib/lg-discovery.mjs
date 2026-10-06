import {document,clean,normalizeDates,canonicalUrl} from './content.mjs';
import {allowedUrl} from './http.mjs';

// Read only the numeric navigation parameters shown by the official page.
// Reservation buttons are evidence; they are never executed.
export function lgListing(html,source,checkedAt,url=source.url) {
  const $=document(html),items=[];
  $('.board__item').each((_,e)=>{
    const row=$(e),title=row.find('a.title').first();
    const ids=/^moveToDetail\(\s*\d+\s*,\s*(\d+)\s*\)\s*;?$/.exec(title.attr('onclick') || '');
    if(!ids)return;
    const link=allowedUrl(`/programs/${ids[1]}?local`,source,url);
    if(!link || !clean(title.text()))return;
    const buttons=row.find('button').toArray(),personal=buttons.find(b=>/개인예약/.test(clean($(b).text())));
    const group=buttons.some(b=>/단체예약/.test(clean($(b).text())) && !$(b).hasClass('btn__negative'));
    items.push({sourceId:source.id,source:source.name,engine:'official',checkedAt,url:link,title:clean(title.text()),
      grade:'',days:'',applyRange:'',activityRange:normalizeDates(row.find('.card__date').text()).replace(/^교육 진행 기간\s*/,''),
      status:clean(row.find('.state').text()),place:clean(row.find('.badge.point-color-bg').text()),cost:'',summary:'',
      individualReservationAvailable:!!personal && !$(personal).hasClass('btn__negative'),
      groupReservationAvailable:group,openingDateScope:'program-envelope',evidence:{row:clean(row.text())}});
  });
  const current=new URL(url),currentPage=Number(current.searchParams.get('page') ?? 0),next=[];
  $('a[href]').each((_,e)=>{
    const link=allowedUrl($(e).attr('href'),source,url);if(!link)return;
    const target=new URL(link);
    if(target.pathname!==current.pathname || !/^\d+$/.test(target.searchParams.get('page') || ''))return;
    const filters=u=>JSON.stringify([...u.searchParams].filter(([k])=>k!=='page').sort());
    if(filters(current)!==filters(target) || Number(target.searchParams.get('page'))<=currentPage)return;
    next.push(link);
  });
  return {items:[...new Map(items.map(i=>[canonicalUrl(i.url),i])).values()],next:[...new Set(next)],emptyConfirmed:false};
}

export function lgDetail(html,source,url) {
  const $=document(html),root=$('.page-program-detail').first(),head=root.find('.program-header__summary').first();
  if(!root.length || !head.find('.program-header__title').text().trim())throw new Error('LG 공식 프로그램 상세 구조를 찾지 못함');
  const fields={};head.find('.program-header__info').each((_,e)=>{fields[clean($(e).children('b').text())]=clean($(e).children('div').text());});
  const reservation=head.find('.btn-wrap a').toArray(),personal=reservation.find(e=>/개인예약/.test(clean($(e).text())));
  const group=reservation.some(e=>/단체예약/.test(clean($(e).text())) && !$(e).hasClass('btn__negative'));
  const individual=!!personal && !$(personal).hasClass('btn__negative');
  const attachments=root.find('#program-intro img[src]').toArray().map(e=>({type:'image',url:allowedUrl($(e).attr('src'),source,url),text:clean($(e).attr('alt'))})).filter(a=>a.url);
  return {grade:fields['교육대상'] || '',applyRange:normalizeDates(fields['신청(예약) 기간']),activityRange:normalizeDates(fields['교육 진행 기간']),
    status:clean(head.find('.program-header__state').text()),days:'',classTime:'',cost:'',
    place:clean(root.find('.program-header .badge.point-color-bg').text()),
    skillDescription:clean(head.find('.program-header__headline').text()),
    requirements:group && !individual?'단체 신청만 가능: 개인 예약 버튼 비활성(조회 시각 기준)':'개별 회차의 예약 가능 여부·일정 확인 필요',
    individualReservationAvailable:individual,groupReservationAvailable:group,openingDateScope:'program-envelope',
    contentText:clean(head.text()+' '+root.find('#program-intro').text()).slice(0,18000),
    attachments:[...new Map(attachments.map(a=>[a.url,a])).values()],evidence:fields};
}
