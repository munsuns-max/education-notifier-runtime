import {atomicJson,readJson,withLock} from './storage.mjs';
import {hash,revisionOf} from './content.mjs';
const pendingHash=p=>p.replyMarkups?hash({parts:p.parts,replyMarkups:p.replyMarkups}):hash(p.parts.join(''));
export function splitText(text, limit=3500) {
 if (!Number.isInteger(limit) || limit < 2) throw new Error('문자 길이 상한 오류');
 const chunks=[];let chunk='';
 for(const c of text) {if(chunk.length+c.length>limit){chunks.push(chunk);chunk='';}chunk+=c;}
 if(chunk)chunks.push(chunk);return chunks;
}
export function validateState(s) {
 if (!s || typeof s.sent!=='object' || !s.sent || Array.isArray(s.sent)) throw new Error('전송 상태 형식 오류');
 if (s.version!==undefined && s.version!==2) throw new Error('지원하지 않는 전송 상태 버전');
 if (Object.hasOwn(s,'pending') && (!s.pending || typeof s.pending!=='object' || Array.isArray(s.pending))) throw new Error('전송 대기 상태 손상');
 for(const entry of Object.values(s.sent)) if (!(typeof entry==='string' && /^\d{4}-\d{2}-\d{2}$/.test(entry)) && !(entry && typeof entry.revision==='string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))) throw new Error('전송 이력 손상');
 if(s.pending && (!Array.isArray(s.pending.parts) || !s.pending.parts.every(p=>typeof p==='string') || !Array.isArray(s.pending.items) || !s.pending.items.every(i=>typeof i.id==='string'&&typeof i.revision==='string') || !Number.isInteger(s.pending.next) || s.pending.next<0 || s.pending.next>s.pending.parts.length || typeof s.pending.inFlight!=='boolean')) throw new Error('전송 대기 상태 손상');
 if(s.pending?.replyMarkups && (!Array.isArray(s.pending.replyMarkups) || s.pending.replyMarkups.length!==s.pending.parts.length || !s.pending.replyMarkups.every(m=>m && Array.isArray(m.inline_keyboard) && m.inline_keyboard.every(row=>Array.isArray(row) && row.every(b=>typeof b.text==='string' && /^https?:\/\//.test(b.url))))))throw new Error('전송 대기 버튼 손상');
 if(s.pending && (!/^\d{4}-\d{2}-\d{2}$/.test(s.pending.day) || !s.pending.parts.length || !s.pending.items.length || s.pending.hash!==pendingHash(s.pending) || s.pending.parts.some(p=>p.length>3500))) throw new Error('전송 대기 내용 손상');
 return s;
}
export async function sendDigest({statePath,lockPath,items,today,limit,heading,format,send,destination='test',includeReview=false,multiplePerDay=false,oncePerItem=false,renderMessages,requireVerifiedCost=false}) {
 const eligible=i=>(!requireVerifiedCost || i.evaluation.checks?.cost?.state==='pass') && (i.evaluation.state==='recommended' || (includeReview && i.evaluation.state==='review' && !i.detail?.error && i.url && i.checkedAt && i.detail?.checkedAt && i.evaluation.checks?.freshness?.state!=='review'));
 return withLock(lockPath,async()=>{
  const state=validateState(await readJson(statePath,{version:2,sent:{}}));
  state.version=2;
  if(state.destination && state.destination!==destination) throw new Error('전송 대상 변경: 기존 전송 상태 검토 필요');
  state.destination=destination;
  if(state.pending?.inFlight) throw new Error('직전 전송 결과 불명: 채팅 수신 여부와 state.json을 확인하기 전 자동 재전송 금지');
  if(state.pending && state.pending.day!==today) throw new Error('이전 날짜의 부분 전송이 남음: 현재 모집 상태 확인 후 수동 복구 필요');
  if(!multiplePerDay && !state.pending && state.lastDigestDay===today) return {sent:0,reason:'오늘 묶음 전송 완료'};
  if(!state.pending) {
   const selected=items.filter(i=>eligible(i) && (!state.sent[i.id] || (!oncePerItem && typeof state.sent[i.id]==='object' && state.sent[i.id].revision!==revisionOf(i)))).slice(0,limit);
   if(!selected.length)return {sent:0,reason:'새로 확인된 추천 없음'};
   const messages=renderMessages?.(selected);
   const text=messages?null:heading+'\n\n'+selected.map((i,n)=>(state.sent[i.id]?'[변경 공고] ':'')+format(i,n)).join('\n\n');
   if(messages && (!messages.length || messages.some(m=>!m.text || m.text.length>3500 || !m.replyMarkup)))throw new Error('알림 본문·버튼 생성 오류');
   state.pending={day:today,parts:messages?messages.map(m=>m.text):splitText(text),...(messages?{replyMarkups:messages.map(m=>m.replyMarkup)}:{}),next:0,inFlight:false,items:selected.map(i=>({id:i.id,revision:revisionOf(i)}))};
   state.pending.hash=pendingHash(state.pending);
   await atomicJson(statePath,state);
  }
  const pending=state.pending;
  // A retry must still have the same eligible items and revisions.
  if(!pending.items.every(p=>items.some(i=>i.id===p.id&&eligible(i)&&revisionOf(i)===p.revision))) throw new Error('부분 전송 후 공고 또는 확인 상태 변경: 수동 복구 필요');
  while(pending.next<pending.parts.length) {
   pending.inFlight=true;await atomicJson(statePath,state);
   try {await send(pending.parts[pending.next],pending.replyMarkups?.[pending.next]);}
   catch(e) {
    if(e.definitelyNotSent) {pending.inFlight=false;await atomicJson(statePath,state);}
    throw e;
   }
   pending.next++;pending.inFlight=false;await atomicJson(statePath,state);
  }
  for(const i of pending.items)state.sent[i.id]={date:today,revision:i.revision};
  state.lastDigestDay=today;const count=pending.items.length;delete state.pending;
  await atomicJson(statePath,state);return {sent:count};
 });
}
