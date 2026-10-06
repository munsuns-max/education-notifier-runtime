import {fileURLToPath} from 'node:url';
import {githubStateStore,hydrateState,installCloudPersistence} from '../lib/cloud-state.mjs';
import {runtimeDecision} from '../lib/runtime-owner.mjs';
import {hash} from '../lib/content.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let store;
try {
 if(process.env.GITHUB_ACTIONS!=='true')throw new Error('GitHub 외부 실행기 전용');
 if(process.argv.slice(2).some(arg=>arg!=='--verify-only'))throw new Error('허용하지 않는 외부 실행 인수');
 store=githubStateStore({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,key:process.env.EDU_STATE_KEY});
 const bundle=await store.load(),op=bundle.files['operation-config.json'];
 const token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
 if(!token||!chat||bundle.files['opening-state.json'].destination!==hash(token+':'+chat))throw new Error('기존 수신 대상과 클라우드 자격 불일치');
 if(!runtimeDecision(op,'github-actions',process.env.GITHUB_REPOSITORY).run)throw new Error('클라우드 실행 주체 전환 필요');
 await hydrateState(root,bundle);installCloudPersistence(root,store);
 // A heartbeat commit keeps the public schedule active even on empty days.
 await store.update('reports/cloud-health.json',{...bundle.files['reports/cloud-health.json'],startedAt:new Date().toISOString(),runtime:'github-actions',runId:process.env.GITHUB_RUN_ID,phase:'started',applicationSubmitted:false});
 if(process.argv.includes('--verify-only')) {
  await store.update('reports/cloud-health.json',{verifiedAt:new Date().toISOString(),runtime:'github-actions',runId:process.env.GITHUB_RUN_ID,phase:'state-verified',telegramRequests:0,applicationSubmitted:false});
  console.log('암호화 상태·정책·기존 수신 대상·외부 저장 확인 완료. Telegram 요청 없음.');
 }else {
  process.env.EDU_RUNTIME='github-actions';process.argv.push('--send');
  await import('../find.mjs');await store.flush();
  const health=(await store.load()).files['reports/cloud-health.json'] || {};
  await store.update('reports/cloud-health.json',{...health,finishedAt:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID,phase:process.exitCode?'completed-with-source-failures':'completed',applicationSubmitted:false});
  console.log('외부 수집·판정 실행 완료. 신청 기능 비활성.');
 }
}catch(error){
 // Do not expose decrypted configuration, URLs, responses, or transport errors in public logs.
 console.error('외부 운영 중단: 상태·수집·전송 단계 확인 필요. 상세 원문은 공개 로그에 출력하지 않습니다.');process.exitCode=1;
}
