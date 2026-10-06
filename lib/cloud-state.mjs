import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {relative,resolve,sep} from 'node:path';
import {atomicJson,setPersistenceHook} from './storage.mjs';
import {validateState} from './digest.mjs';
import {notificationPolicy} from './operation.mjs';

export const stateFiles=['config.json','sources.json','operation-config.json','operation-exclusions.json','reviews.json','opening-state.json','reports/request-suspensions.json','reports/cloud-health.json','reports/notification-latest.json'];
const aad=Buffer.from('education-notifier-state-v1');
function keyBytes(key) {
 if(typeof key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(key)||Buffer.from(key,'base64').length!==32)throw new Error('클라우드 암호화 키 설정 오류');
 return Buffer.from(key,'base64');
}
export function sealState(bundle,key) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);cipher.setAAD(aad);
 const bytes=Buffer.concat([cipher.update(JSON.stringify(bundle),'utf8'),cipher.final()]);
 return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')};
}
export function openState(envelope,key) {
 try {
  if(envelope?.version!==1)throw new Error();
  const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),Buffer.from(envelope.iv,'base64'));decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return validateBundle(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8')));
 }catch{throw new Error('클라우드 상태 복호화·검증 실패: 빈 상태로 시작하지 않음');}
}
export function validateBundle(bundle) {
 if(bundle?.version!==1||!bundle.files||typeof bundle.files!=='object'||Array.isArray(bundle.files)||Object.keys(bundle.files).some(p=>!stateFiles.includes(p)))throw new Error('클라우드 상태 파일 범위 오류');
 for(const p of ['config.json','sources.json','operation-config.json','operation-exclusions.json','reviews.json','opening-state.json','reports/request-suspensions.json'])if(!Object.hasOwn(bundle.files,p))throw new Error('필수 클라우드 상태 누락');
 validateState(bundle.files['opening-state.json']);
 const ledger=bundle.files['reports/request-suspensions.json'];
 if(ledger?.version!==1||!ledger.requests||typeof ledger.requests!=='object'||Array.isArray(ledger.requests))throw new Error('실패 보류 기록 오류');
 const op=bundle.files['operation-config.json'];notificationPolicy(op,{schedule:true});
 if(op.notificationCadence!=='opening'||op.maxDigest!=='all'||op.requireVerifiedCost!==true||op.applicationSubmissionEnabled!==false||op.notificationTime!=='09:00'||op.checkIntervalMinutes!==60)throw new Error('알림·신청 정책 변경 차단');
 if(!Array.isArray(bundle.files['sources.json'])||!Array.isArray(bundle.files['reviews.json'])||!Array.isArray(bundle.files['operation-exclusions.json']))throw new Error('클라우드 목록 상태 오류');
 return bundle;
}
export function githubStateStore({repository,token,key,fetch:request=globalThis.fetch,branch='main'}) {
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')||!token)throw new Error('GitHub 실행 자격 설정 오류');
 keyBytes(key);
 const endpoint=`https://api.github.com/repos/${repository}/contents/cloud-state.enc.json`;
 let sha,bundle,queue=Promise.resolve(),fatal=false;
 const api=async(method,body)=>{
  let response;
  try {response=await request(endpoint+(method==='GET'?`?ref=${branch}`:''),{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}catch{throw new Error('클라우드 상태 네트워크 실패');}
  if(!response.ok)throw new Error(`클라우드 상태 ${method} 실패 HTTP ${response.status}`);
  try{return await response.json();}catch{throw new Error('클라우드 상태 응답 형식 오류');}
 };
 const load=async()=>{const file=await api('GET');if(!file.sha||!file.content||file.encoding!=='base64')throw new Error('클라우드 상태 파일 누락');sha=file.sha;bundle=openState(JSON.parse(Buffer.from(file.content,'base64').toString('utf8')),key);return structuredClone(bundle);};
 const put=async(next)=>{
  if(fatal)throw new Error('이전 클라우드 저장 실패: 실행 중단 필요');
  try {
   const content=Buffer.from(JSON.stringify(sealState(validateBundle(next),key))+'\n').toString('base64');
   const result=await api('PUT',{message:'Persist encrypted runtime state',content,sha,branch});
   if(!result.content?.sha)throw new Error('클라우드 저장 확인 누락');sha=result.content.sha;bundle=structuredClone(next);
  }catch(e){fatal=true;throw e;}
 };
 const update=(path,value)=>{
  const copy=structuredClone(value);
  queue=queue.then(async()=>{if(!bundle||!sha)throw new Error('클라우드 상태 먼저 읽기 필요');const next=structuredClone(bundle);next.files[path]=copy;next.updatedAt=new Date().toISOString();await put(next);});
  return queue;
 };
 return {load,update,flush:()=>queue,failed:()=>fatal};
}
export async function hydrateState(root,bundle) {
 validateBundle(bundle);
 for(const [path,data]of Object.entries(bundle.files))await atomicJson(resolve(root,path),data);
}
export function installCloudPersistence(root,store) {
 const base=resolve(root);
 setPersistenceHook(async(target,data)=>{
  const path=relative(base,resolve(target)).split(sep).join('/');
  if(stateFiles.includes(path))await store.update(path,data);
  else if(path==='reports/collection-latest.json')await store.update('reports/cloud-health.json',{
   checkedAt:new Date().toISOString(),runtime:'github-actions',sourceCount:data.sourceCount,registered:data.registered,counts:data.counts,
   failures:data.failures.map(f=>({sourceId:f.sourceId,error:f.error})),coverage:data.coverage.map(c=>({sourceId:c.sourceId,requests:c.requests,skippedDetails:c.skippedDetails,completeWithinScope:c.completeWithinScope})),applicationSubmitted:false
  });
 });
 return ()=>setPersistenceHook(undefined);
}
