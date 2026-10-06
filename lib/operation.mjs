import {fetchPage, postJson} from './http.mjs';
import {atomicJson} from './storage.mjs';
import {hash} from './content.mjs';
import {checkInterval} from './task-xml.mjs';

export function notificationPolicy(settings, {schedule=false}={}) {
  if (!['recommended', 'include-review'].includes(settings.notificationScope)) throw new Error('알림 범위 미확정: operation-config.json 설정 필요');
  if (settings.maxDigest!=='all' && (!Number.isSafeInteger(settings.maxDigest) || settings.maxDigest < 1 || settings.maxDigest > 100)) throw new Error('알림 최대 건수 미확정 또는 오류');
  if (schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.notificationTime || '')) throw new Error('매일 알림 시각 미확정');
  if(schedule && settings.notificationCadence==='opening')checkInterval(settings);
  return {includeReview:settings.notificationScope==='include-review', limit:settings.maxDigest==='all'?Number.MAX_SAFE_INTEGER:settings.maxDigest};
}

// A known failed request remains suspended until official evidence is recorded.
export function guardedRequests(ledger, path, {fetch=fetchPage, post=postJson}={}) {
  if (!ledger || ledger.version!==1 || !ledger.requests || typeof ledger.requests!=='object' || Array.isArray(ledger.requests)) throw new Error('실패 조회 기록 형식 오류');
  let persistence=Promise.resolve();
  const guard = async (kind, url, source, fields, options) => {
    const normalized=new URL(url); normalized.hash=''; normalized.searchParams.sort();
    const key=hash([kind,source.id,normalized.href,fields || null]);
    const previous=ledger.requests[key];
    if(previous && !(typeof previous.resumeEvidence==='string' && previous.resumeEvidence.trim() && Date.parse(previous.resumeRecordedAt)>Date.parse(previous.failedAt)))
      throw new Error(`기존 실패 조회 보류: ${previous.error} (새 공식 근거 필요)`);
    try { return await (kind==='html'?fetch(url,source,options):post(url,source,fields,options)); }
    catch(error) {
      ledger.requests[key]={sourceId:source.id,url,kind,fields:fields || null,failedAt:new Date().toISOString(),error:error.message,
        ...(previous?{previousFailure:previous}: {})};
      persistence=persistence.then(()=>atomicJson(path,ledger));
      await persistence;
      throw error;
    }
  };
  return {fetch:(url,source,options)=>guard('html',url,source,null,options),post:(url,source,fields,options)=>guard('api',url,source,fields,options)};
}
