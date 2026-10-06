import {clean,normalizeDates} from './content.mjs';
const shorten=(value,n)=>{const text=clean(value);return text.length>n?text.slice(0,n-1)+'…':text;};
const range=value=>normalizeDates(value).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,(_,y,m,d)=>`${Number(y)===new Date().getFullYear()?'':y+'/'}${Number(m)}/${Number(d)}`).replace(/\s*~\s*/g,' ~ ') || '미확인';
export function compactCard(item,index=0) {
  const d=item.detail || {},checks=item.evaluation?.checks || {};
  const summary=d.skillDescription || item.summary;
  const questions=[['grade','대상'],['schedule','일정'],['cost','비용'],['application','접수 상태']].filter(([key])=>checks[key]?.state==='review').map(([,label])=>label);
  if(!d.grade && !item.grade && !questions.includes('대상'))questions.push('대상');
  if(!d.cost && !item.cost && !questions.includes('비용'))questions.push('비용');
  const warning=item.evaluation?.state==='review'?`\n\n⚠️ ${questions.length?questions.join('·'):'자격·필수 일정'} 확인 필요`:'';
  return `${index+1}. ✨ ${shorten(item.title,75)}${summary?'\n'+shorten(summary,75):''}\n\n`
    +`📅 신청 ${range(d.applyRange || item.applyRange)}\n`
    +`🗓 활동 ${range(d.activityRange || item.activityRange)}\n`
    +`📍 ${shorten(d.place || item.place || '장소 미확인',35)} · 💰 ${shorten(d.cost || item.cost || '비용 미확인',30)}${warning}`;
}
export function compactMessages(items,{heading='📢 신청 시작 알림'}={}) {
  const messages=[];let text=heading,buttons=[];
  for(const [index,item] of items.entries()) {
    const link=new URL(item.officialDetailUrl || item.url);
    if(!['https:','http:'].includes(link.protocol) || link.username || link.password)throw new Error('안내 버튼 주소 오류');
    const card=compactCard(item,index);
    if((text+'\n\n'+card).length>3500 || buttons.length>=8) {
      messages.push({text,replyMarkup:{inline_keyboard:buttons}});text=heading;buttons=[];
    }
    text+='\n\n'+card;
    buttons.push([{text:items.length===1?'🔎 자세히 보기':`${index+1}. 🔎 자세히 보기`,url:link.href}]);
  }
  if(buttons.length)messages.push({text,replyMarkup:{inline_keyboard:buttons}});
  return messages;
}
