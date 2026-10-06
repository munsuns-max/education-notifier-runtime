import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mapLimit } from './lib/http.mjs';
import { evaluate } from './lib/conditions.mjs';
import { collectSource } from './lib/collector.mjs';
import { applyReviews } from './lib/reviews.mjs';
import { readJson } from './lib/storage.mjs';
import { sendDigest } from './lib/digest.mjs';
import { hash,canonicalUrl } from './lib/content.mjs';
import { interestScore } from './lib/ranking.mjs';
import {guardedRequests,notificationPolicy} from './lib/operation.mjs';
import {atomicJson} from './lib/storage.mjs';
import {telegramClient} from './lib/telegram.mjs';
import {openingCandidates} from './lib/openings.mjs';
import {compactMessages} from './lib/compact-alert.mjs';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {runtimeDecision} from './lib/runtime-owner.mjs';
const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(fileURLToPath(envFile));

const args = new Set(process.argv.slice(2));
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const sources = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'));
const stateUrl = new URL('./state.json', import.meta.url);
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const now = new Date();
const offline = args.has('--offline');
const operation=await readJson(new URL('./operation-config.json',import.meta.url),{});
let sendPolicy;
if(args.has('--send')) {
  if(!runtimeDecision(operation,process.env.EDU_RUNTIME || 'pc',process.env.GITHUB_REPOSITORY || '').run) {
    console.log('다른 실행 주체가 운영 중: 발송 생략');process.exit(0);
  }
  sendPolicy=notificationPolicy(operation);
  if(!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID를 로컬에 설정하세요.');
}
const ledgerPath=new URL('./reports/request-suspensions.json',import.meta.url);
const requests=guardedRequests(await readJson(ledgerPath,{version:1,requests:{}}),ledgerPath);
const exclusions=await readJson(new URL('./operation-exclusions.json',import.meta.url),[]);
const exclusionFor=item=>exclusions.find(r=>item.url && canonicalUrl(r.url)===canonicalUrl(item.url))?.reason;

async function telegram(method, body) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
  return telegramClient({token,chatId:chatId || 'lookup'})(method,body);
}
if (args.has('--chat-id')) {
  const updates = await telegram('getUpdates', { limit: 20 });
  const chats = [...new Map(updates.filter(u => u.message?.chat?.type === 'private')
    .map(u => [u.message.chat.id, u.message.chat])).values()];
  if (!chats.length) console.log('개인 채팅이 없습니다. 봇에게 /start를 보낸 뒤 다시 실행하세요.');
  else for (const chat of chats) console.log(`${chat.first_name || '개인 채팅'}: ${chat.id}`);
  process.exit(0);
}
if (!args.has('--preview') && !args.has('--send') && !args.has('--collect')) {
  console.log('사용법: node find.mjs --collect | --preview [--save-preview] [--offline] | --send | --chat-id');
  process.exit(0);
}
if (offline && args.has('--send')) throw new Error('저장된 과거 페이지로는 알림을 전송할 수 없습니다.');
const boards = sources.filter(s => s.collectionStatus === 'connected');
const reviews = await readJson(new URL('./reviews.json', import.meta.url), []);
if (!Array.isArray(reviews)) throw new Error('수동 확인 기록 형식 오류');
const failures = [], coverage = [];
const results = await mapLimit(boards, 2, async source => {
  let collected;
  if (offline) {
    try {
      const html = await readFile(new URL('./.cache/probe/'+source.id+'.html', import.meta.url), 'utf8');
      const {parseListing} = await import('./lib/adapters.mjs');
      const rows = parseListing(html, source, null, source.url).items;
      collected = {items:rows.map(i=>({...i,detail:{error:'오프라인: 상세 미조회'}})),report:{sourceId:source.id,source:source.name,scope:'과거 등록 주소 캐시만 검토',completeWithinScope:false,pages:[],failures:[],skippedDetails:rows.length,pendingPages:[]}};
    } catch(e) {collected={items:[],report:{sourceId:source.id,source:source.name,completeWithinScope:false,pages:[],failures:[{error:e.message}],pendingPages:[],skippedDetails:0}};}
  } else collected = await collectSource(source, {...config.collection,...requests,skipDetail:exclusionFor,cacheDir:new URL('./.cache/candidates/', import.meta.url)});
  coverage.push(collected.report);
  failures.push(...collected.report.failures.map(f=>({...f,sourceId:source.id,source:source.name})));
  for (const item of collected.items) {
    item.evaluation = evaluate(item, config, now);
    if (offline) {
      item.evaluation.checks.freshness={state:'review',reason:'과거 저장 페이지: 현재 모집 여부 미검증',evidence:''};
      item.evaluation.reasons.push('과거 저장 페이지: 현재 모집 여부 미검증');
      if(item.evaluation.state==='recommended')item.evaluation.state='review';
    } else item.evaluation=applyReviews(item,config,reviews,now);
    const excludedReason=exclusionFor(item);
    if(excludedReason) {item.evaluation.checks.userParticipation={state:'exclude',reason:excludedReason,evidence:item.url};item.evaluation.state='excluded';item.evaluation.reasons.push(excludedReason);}
  }
  return collected.items;
});
const items = results.flat();
const unique = new Map();
for (const item of items) {
  const identity = item.url || `${item.sourceId}:${item.title}:${item.applyRange}`;
  item.id = createHash('sha256').update(identity).digest('hex').slice(0, 20);
  if (!unique.has(item.id)) unique.set(item.id, { ...item, score: interestScore(item) });
}
const all = [...unique.values()];
const ranked = all.filter(item => item.evaluation.state !== 'excluded').sort((a, b) =>
  Number(b.evaluation.state === 'recommended') - Number(a.evaluation.state === 'recommended') || b.score - a.score
  || Number(!b.detail?.error)-Number(!a.detail?.error));
const today = now.toLocaleDateString('sv-SE', { timeZone: config.timezone });
const inExam = operation.examEndConfirmed===true && config.examEnd && today >= config.examStart && today <= config.examEnd;
const limit = inExam ? config.maxExamDigest : config.maxDigest;
const selected = ranked.slice(0, limit);
function format(item, index) {
  return `${index + 1}. [${item.evaluation.state === 'recommended' ? '조건 확인' : '확인 필요'}] ${item.title}\n`
    + `분야: ${item.summary || '원문 확인'}\n`
    + (item.detail?.skillDescription ? `내용: ${item.detail.skillDescription.slice(0,700)}\n` : '')
    + (item.detail?.difficulty || item.detail?.lessonInfo ? `난이도: ${item.detail.difficulty || '미표시'} / 분량: ${item.detail.lessonInfo || '미표시'}\n` : '')
    + (item.detail?.prerequisites ? `선행 실력: ${item.detail.prerequisites}\n` : '')
    + `신청: ${item.detail?.applyRange || item.applyRange || '원문 확인'} | ${item.detail?.status || item.status || '상태 미확인'}\n`
    + `활동: ${item.detail?.activityRange || item.activityRange || '원문 확인'} / ${item.detail?.days || item.days || (item.mode==='self-paced'?'자율 수강(필수 일정 별도 확인)':'요일 미확인')}\n수업시간: ${item.classTime || '원문 확인'}\n`
    + (item.detail?.sessions?.length ? `차시별 수업일: ${item.detail.sessions.join(', ')}\n` : '')
    + `장소: ${item.detail?.place || item.place || '원문 확인'}\n대상: ${item.detail?.grade || item.grade || '원문 확인'}\n비용: ${item.detail?.cost || item.cost || '총액·재료비 미확인'}\n`
    + `학년 판정: ${item.evaluation.checks.grade.reason}\n`
    + (item.detail?.requirements ? `상세 자격 표기: ${item.detail.requirements}\n` : '')
    + (item.evaluation.reasons.length ? `확인 사항: ${item.evaluation.reasons.join('; ')}\n` : '')
    + `추천 이유: 관심 분야·입문·활동 내용을 기준으로 정렬한 검토 후보. 개인 자격 승인은 별도.\n`
    + `근거 시각: 목록 ${item.checkedAt || '미확인'}, 상세 ${item.detail?.checkedAt || '미확인'}${item.detail?.fromCache?' (저장 근거)':''}\n`
    + `출처: ${item.source}\n${item.url || '상세 링크 미확인'}`;
}
const heading = `주말 청소년 활동 후보 · ${today}${offline ? ' (과거 저장 페이지 검토)' : ''}\n`
  + `11월 12일 전까지 교육 신청만 보류합니다. 수집·판정·알림은 계속됩니다.\n`
  + `조회 범위: 등록된 공식 출처 47개 중 연결된 ${boards.length}곳(요청·페이지·상세 상한 적용). 이동시간·추가 자격은 개별 확인 필요.\n`;
const coverageText = coverage.map(r => `${r.source}: 목록 ${r.pages.length}페이지, 상세 미조회 ${r.skippedDetails}건, 남은 HTML 페이지 ${r.pendingPages.length}개/API 페이지 ${r.pendingApi || 0}개, ${r.completeWithinScope?'설정 범위 조회 완료':'불완전'} (${r.scope || '등록 목록'})`).join('\n');
const digest = heading + (selected.length ? '\n' + selected.map(format).join('\n\n')
  : failures.length || coverage.some(r=>!r.completeWithinScope) ? '\n수집이 불완전하여 전체 후보 유무를 판단할 수 없습니다.' : '\n읽은 목록에서 조건을 통과한 후보가 없습니다.')
  + (failures.length ? `\n\n수집 실패: ${failures.map(f => `${f.source}: ${f.error}`).join('; ')}` : '');
if (args.has('--preview') || args.has('--collect')) {
  console.log(digest + '\n\n수집 범위\n' + coverageText);
  console.error(`\n조회 ${items.length}건, 확인 필요 ${all.filter(i => i.evaluation.state === 'review').length}건, 제외 ${all.filter(i => i.evaluation.state === 'excluded').length}건, 실패가 있는 출처 ${new Set(failures.map(f=>f.sourceId)).size}/${boards.length}곳`);
  if (failures.length) process.exitCode = 1;
  if (args.has('--save-preview') || args.has('--collect')) {
    await writeFile(new URL(args.has('--collect')?'./reports/operation-preview.md':'./preview.md', import.meta.url), digest + '\n\n수집 범위\n' + coverageText + '\n', 'utf8');
    await mkdir(new URL('./reports/', import.meta.url), { recursive: true });
    if(!args.has('--collect'))await writeFile(new URL('./reports/candidate-check.json', import.meta.url), JSON.stringify({ checkedAt: now.toISOString(), offline,
      sourceCount: boards.length, failures, coverage, items: all }, null, 2) + '\n', 'utf8');
  }
}
if(!offline) {
  await atomicJson(new URL('./reports/collection-latest.json',import.meta.url),{startedAt:now.toISOString(),finishedAt:new Date().toISOString(),sourceCount:boards.length,
    registered:sources.length,failures,coverage,counts:{collected:all.length,recommended:all.filter(i=>i.evaluation.state==='recommended').length,review:all.filter(i=>i.evaluation.state==='review').length,excluded:all.filter(i=>i.evaluation.state==='excluded').length},items:all});
  if(failures.length)process.exitCode=1;
}
if (args.has('--send')) {
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID를 설정하세요.');
  const openingOnly=operation.notificationCadence==='opening';
  if(!openingOnly && operation.notificationCadence!=='daily')throw new Error('알림 주기 미확정 또는 미구현');
  const sendNow=new Date(),sendToday=sendNow.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  const openings=openingOnly?openingCandidates(ranked,{now:sendNow,dateOnlyTime:operation.notificationTime}):null;
  const result = await sendDigest({statePath:openingOnly?new URL('./opening-state.json',import.meta.url):stateUrl,lockPath:new URL('./send.lock',import.meta.url),destination:hash(token+':'+chatId),items:openings?.items || ranked,today:sendToday,limit:sendPolicy.limit,includeReview:sendPolicy.includeReview,
    multiplePerDay:openingOnly,oncePerItem:openingOnly,
    requireVerifiedCost:operation.requireVerifiedCost===true,
    heading:(openingOnly?'신청 시작일 알림\n':'')+heading+'\n'+coverageText,format,
    renderMessages:selected=>compactMessages(selected,{heading:openingOnly?'📢 신청 시작 알림\n⏸ 11/12 전까지 교육 신청만 보류':'📢 교육 후보 알림\n⏸ 11/12 전까지 교육 신청만 보류'}),
    send:(text,replyMarkup)=>telegram('sendMessage',{chat_id:chatId,text,reply_markup:replyMarkup,link_preview_options:{is_disabled:true}})});
  console.log(result.sent+'건 전송. '+(result.reason || ''));
  await atomicJson(new URL('./reports/notification-latest.json',import.meta.url),{checkedAt:new Date().toISOString(),...result,scope:operation.notificationScope,cadence:operation.notificationCadence,openingCandidates:openings?.items.length,heldForUnknownDates:openings?.held.length,applicationSubmitted:false});
}
