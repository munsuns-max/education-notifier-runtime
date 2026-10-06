import {fetchPage,allowedUrl} from './http.mjs';
import {newsacPage,newsacProgram,newsacCourses} from './newsac.mjs';
import {interestScore} from './ranking.mjs';
import {clean} from './content.mjs';

export async function collectNewsac(source,{fetch=fetchPage,cacheDir,maxPages=2,maxDetails=12,maxRequests=40,maxApiPagesPerQuery=2}={}) {
  const report={sourceId:source.id,source:source.name,startedAt:new Date().toISOString(),scope:source.collectionScope,pages:[],failures:[],requests:0,pendingPages:[],pendingApi:0,apiQueries:[],skippedDetails:0,cachedDetails:0};
  const items=[],programs=new Map();
  const get=async target=>{
    if(report.requests>=maxRequests)throw new Error('수집 요청 상한: 미조회');
    const url=allowedUrl(target,source);if(!url)throw new Error('허용한 공식 출처 밖의 주소');
    report.requests++;
    const page=await fetch(url,source,{cacheDir});
    let data;try{data=JSON.parse(page.html);}catch{throw new Error('디지털새싹 API가 JSON을 반환하지 않음');}
    return {data,page};
  };
  let year;
  try {
    // The public UI loads the season through its documented cache route.
    // The direct season service returned HTTP 401 and stays suspended.
    const {data,page}=await get('/api/cache/current-season');
    if(!/^\d{4}$/.test(String(data.year || '')))throw new Error('공식 현재 운영 연도 미확인');
    year=String(data.year);report.season={year,url:page.url,checkedAt:page.checkedAt};
  }catch(e){report.failures.push({url:allowedUrl('/api/cache/current-season',source),error:e.message});}
  const queue=year?(source.collectionUrls || []).map(v=>{const u=new URL(v);u.searchParams.set('season',year);return u.href;}):[];
  const visited=new Set();
  while(queue.length && report.pages.length<maxPages && report.requests<maxRequests) {
    const target=queue.shift();if(visited.has(target))continue;visited.add(target);
    try {
      const {data,page}=await get(target),listing=newsacPage(data);
      report.pages.push({url:page.url,checkedAt:page.checkedAt,count:listing.content.length,totalCount:listing.totalCount,page:listing.page,totalPages:listing.totalPageCount,emptyConfirmed:listing.totalCount===0});
      for(const row of listing.content)if(!programs.has(row.programId))programs.set(row.programId,{row,checkedAt:page.checkedAt});
      if(listing.page<listing.totalPageCount){const next=new URL(target);next.searchParams.set('page',String(listing.page+1));queue.push(next.href);}
    }catch(e){report.failures.push({url:target,error:e.message});if(/HTTP (?:401|403)/.test(e.message))break;}
  }
  report.pendingPages=queue.filter(v=>!visited.has(v));
  const ordered=[...programs.values()].sort((a,b)=>Number(b.row.middleSchoolCnt>0)-Number(a.row.middleSchoolCnt>0) || interestScore({title:b.row.programName,summary:b.row.programSummary})-interestScore({title:a.row.programName,summary:a.row.programSummary}));
  for(const [index,{row,checkedAt}] of ordered.entries()) {
    const listItem={sourceId:source.id,source:source.name,engine:'official',checkedAt,title:row.programName,summary:row.programSummary || '',url:allowedUrl(`/public/program/list/${row.programId}`,source),grade:'',days:'',applyRange:'',activityRange:'',place:row.programRegionName || '',cost:'',status:({'C1101':'모집 예정','C1102':'모집 중','C1103':'모집 완료'}[row.operationStatusCode] || '')};
    if(index>=maxDetails || report.requests>=maxRequests) {items.push({...listItem,detail:{error:'상세 수집 상한: 미조회'}});report.skippedDetails++;continue;}
    const programUrl=allowedUrl(`/newsac/api/v1/programs/${row.programId}`,source);
    try {
      const response=await get(programUrl),program=newsacProgram(response.data,source,response.page.checkedAt);
      if(response.data.programId!==row.programId || program.title!==clean(row.programName))throw new Error('목록·상세 프로그램 식별자·제목 불일치');
      program.checkedAt=checkedAt;
      if(response.data.programTypeCode!=='C0102') {items.push(program);continue;}
      let coursePage=1,totalPages=1,courseItems=[];
      do {
        const courseUrl=allowedUrl(`/newsac/api/v1/programs/${row.programId}/courses?size=32&page=${coursePage}`,source);
        if(report.requests>=maxRequests)break;
        const {data,page}=await get(courseUrl);
        totalPages=Number.isSafeInteger(data.totalPageCount)?data.totalPageCount:1;
        courseItems.push(...newsacCourses(data,program,source,page.checkedAt).map(i=>({...i,checkedAt})));
        report.apiQueries.push({url:page.url,checkedAt:page.checkedAt,count:data.content.length,totalCount:data.totalCount,page:coursePage});
        coursePage++;
      }while(coursePage<=totalPages && coursePage<=maxApiPagesPerQuery);
      if(coursePage<=totalPages)report.pendingApi+=totalPages-coursePage+1;
      if(courseItems.length)items.push(...courseItems);
      else items.push({...program,detail:{...program.detail,requirements:program.detail.requirements+'; 공개 회차 없음: 실제 신청 일정 미확인'}});
    }catch(e){items.push({...listItem,detail:{error:e.message}});report.failures.push({url:programUrl,error:e.message});if(/HTTP (?:401|403)/.test(e.message)){report.skippedDetails+=ordered.length-index-1;break;}}
  }
  report.finishedAt=new Date().toISOString();
  report.completeWithinScope=!report.failures.length && !report.pendingPages.length && !report.pendingApi && !report.skippedDetails;
  return {items,report};
}
