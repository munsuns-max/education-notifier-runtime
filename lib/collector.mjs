import { fetchPage, postJson, allowedUrl } from './http.mjs';
import { parseListing, parseSourceDetail, sourceDetailUrl, sourceReadRequest } from './adapters.mjs';
import { canonicalUrl,clean } from './content.mjs';
import { expandApi } from './api-listings.mjs';
import { interestScore } from './ranking.mjs';
import {goeContext,expandGoeApi} from './goe-listings.mjs';
import {loadDetailPage,saveDetailPage} from './detail-cache.mjs';
import {collectNewsac} from './newsac-collector.mjs';

export async function collectSource(source, { fetch = fetchPage, post = postJson, skipDetail=()=>false, cacheDir, detailCacheDir=cacheDir?new URL('../details/',cacheDir):undefined, maxPages = 2, maxDetails = 12, maxRequests = 14, maxApiRequests=20, maxApiPagesPerQuery=2, maxGoePages=maxPages } = {}) {
  const checkIdentity=(item,detail)=>{
    if(source.adapter==='official-board'){
      const listTitle=clean(item.title),detailTitle=clean(detail.title);
      const prefix=source.boardSpec?.truncatedTitles?listTitle.replace(/(?:\.{3}|…)$/,''):listTitle;
      if(!detailTitle || !(detailTitle.includes(listTitle)||listTitle.includes(detailTitle)||prefix!==listTitle&&prefix.length>=12&&detailTitle.startsWith(prefix)))throw new Error('공식 게시물 목록·상세 제목 불일치');
    }
    return detail;
  };
  for (const n of [maxPages,maxDetails,maxRequests,maxApiRequests,maxApiPagesPerQuery,maxGoePages]) if (!Number.isInteger(n) || n < 1) throw new Error('수집 상한은 양의 정수여야 함');
  if(source.id===47&&source.boardSpec?.jsonList==='kakao-channel')maxDetails=Math.min(maxDetails,2);
  if(source.boardSpec?.jsonList==='kau-notices')maxDetails=Math.min(maxDetails,2);
  const readPage=async(url,options)=>{
    const request=sourceReadRequest(url,source);
    if(!request)return fetch(url,source,options);
    const checkedAt=new Date().toISOString(),data=await post(request.url,source,request.fields,{format:'json'});
    return {url,requestedUrl:url,checkedAt,html:JSON.stringify(data),status:200};
  };
  if(source.adapter==='newsac')return collectNewsac(source,{fetch,cacheDir,maxPages,maxDetails,maxRequests,maxApiPagesPerQuery});
  const queue = [...(source.collectionUrls || [source.url])];
  const visited = new Set(), items = new Map();
  const goeRequestContexts=new Map();
  const report = {sourceId:source.id, source:source.name, startedAt:new Date().toISOString(), scope:source.collectionScope || '등록 목록의 제한된 페이지', pages:[], failures:[], requests:0, pendingPages:[], pendingApi:0, apiQueries:[], skippedDetails:0,cachedDetails:0};
  const pageKey = value => {const u = new URL(value); u.hash='';u.searchParams.sort();return u.href;};
  while (queue.length && report.pages.length < maxPages && report.requests < maxRequests) {
    const url = queue.shift();
    if (!allowedUrl(url,source) || visited.has(pageKey(url))) continue;
    visited.add(pageKey(url));
    report.requests++;
    try {
      const page = await readPage(url, {cacheDir});
      if(source.adapter==='goe-online') {
        const type=new URL(url).pathname.endsWith('/type/realtime')?'LIVE':'CONTENT';
        goeRequestContexts.set(type,goeContext(page.html,type));
      }
      visited.add(pageKey(page.url));
      const listing = parseListing(page.html,source,page.checkedAt,page.url);
      report.pages.push({url:page.url,checkedAt:page.checkedAt,count:listing.items.length,emptyConfirmed:listing.emptyConfirmed,
        ...(listing.emptyEvidence?{emptyEvidence:listing.emptyEvidence}:{})});
      if (!listing.items.length && !listing.emptyConfirmed) report.failures.push({url:page.url,error:'빈 목록·동적 화면·구조 변경: 모집 유무 미확인'});
      for (const item of listing.items) if (!items.has(canonicalUrl(item.url))) items.set(canonicalUrl(item.url),item);
      for (const next of listing.next) if (!visited.has(pageKey(next)) && !queue.some(q=>pageKey(q)===pageKey(next))) queue.push(next);
      const pageNumber=value=>Number([...new URL(value).searchParams].find(([key])=>/^(page|pageIndex|pageNo)$/.test(key))?.[1]||1);
      queue.sort((a,b)=>pageNumber(a)-pageNumber(b));
    } catch(e) {report.failures.push({url,error:e.message});}
  }
  report.pendingPages = queue.filter(q=>!visited.has(pageKey(q)));
  if(source.adapter==='goe-online') {
    let usedApi=0;
    const types=[...new Set((source.collectionUrls||[source.url]).map(u=>new URL(u).pathname.endsWith('/type/realtime')?'LIVE':'CONTENT'))];
    for(const type of types) {
      const api=await expandGoeApi(source,{context:goeRequestContexts.get(type)||{courseType:type},post,
        maxRequests:Math.min(maxApiRequests-usedApi,Math.max(0,maxRequests-report.requests)),maxPages:maxGoePages});
      usedApi+=api.requests;report.requests+=api.requests;report.pendingApi+=api.pendingApi;report.apiQueries.push(...api.queries);
      report.failures.push(...api.failures);
      for(const item of api.items) items.set(canonicalUrl(item.url),item);
    }
  }
  if (['gseek','kmooc'].includes(source.adapter)) {
    const api=await expandApi(source,{post,maxRequests:Math.min(maxApiRequests,Math.max(0,maxRequests-report.requests)),maxPagesPerQuery:maxApiPagesPerQuery});
    report.requests+=api.requests;
    report.pendingApi=api.pendingApi;
    report.apiQueries=api.queries;
    report.failures.push(...api.failures);
    for(const item of api.items) if(!items.has(canonicalUrl(item.url))) items.set(canonicalUrl(item.url),item);
  }
  let details = 0;
  const detailOrder=[...items.values()].sort((a,b)=>interestScore(b)-interestScore(a));
  for (const item of detailOrder) {
    const reason=skipDetail(item);
    if(reason) { item.detail={notCollectedReason:reason}; (report.policySkippedDetails ||= []).push({url:item.url,reason}); continue; }
    if(source.boardSpec?.jsonList==='kau-notices'&&details+report.cachedDetails>=maxDetails){
      item.detail={error:'상세 수집 상한: 미조회'};report.skippedDetails++;continue;
    }
    try {
      const cached=await loadDetailPage(detailCacheDir,item);
      if(cached&&allowedUrl(cached.url,source)) {
        item.detail={...checkIdentity(item,parseSourceDetail(cached.html,source,cached.url)),url:cached.url,checkedAt:cached.checkedAt,fromCache:true};
        item.classTime=item.detail.classTime||item.classTime;report.cachedDetails++;continue;
      }
    }catch { /* A failed cache read/parse must fall back to a current request. */ }
    if (details >= maxDetails || report.requests >= maxRequests) {
      item.detail={error:'상세 수집 상한: 미조회'}; report.skippedDetails++; continue;
    }
    details++; report.requests++;
    try {
      const page = await readPage(sourceDetailUrl(item.url,source),{cacheDir});
      item.detail={...checkIdentity(item,parseSourceDetail(page.html,source,page.url)),url:page.url,checkedAt:page.checkedAt};
      item.classTime=item.detail.classTime || item.classTime;
      await saveDetailPage(detailCacheDir,item,page);
    } catch(e) {item.detail={error:e.message};report.failures.push({url:item.url,error:e.message});}
  }
  report.finishedAt=new Date().toISOString();
  report.completeWithinScope=!report.failures.length && !report.pendingPages.length && !report.pendingApi && !report.skippedDetails;
  return {items:[...items.values()],report};
}
