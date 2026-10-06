import {allowedUrl} from './http.mjs';
import {clean} from './content.mjs';

// Read the public tenant identifier and exact list query without running site scripts.
export function goeContext(html,courseType='CONTENT') {
  if(!['CONTENT','LIVE'].includes(courseType)) throw new Error('경기온라인학교 강좌 유형 오류');
  const text=html.replaceAll('\\"','"');
  const tenantId=text.match(/"tenantId":"([A-Za-z0-9+/=]+)"/)?.[1];
  const query=text.match(/"query":"(query CourseListPageQuery[^"\n]+)"/)?.[1];
  if(!tenantId||!query) throw new Error('경기온라인학교 공개 기관 식별자·목록 쿼리 미확인');
  return {tenantId,query,courseType};
}
const audience = value => {
  const m=/^(ELEMENTARY|MIDDLE|HIGH)_([1-6])$/.exec(value);
  if(!m || (m[1]!=='ELEMENTARY' && Number(m[2])>3)) return value;
  return {ELEMENTARY:'초',MIDDLE:'중',HIGH:'고'}[m[1]]+m[2];
};
export function goeApiItem(row,source,checkedAt) {
  if(!row || typeof row.id!=='string' || !/^[A-Za-z0-9+_-]+={0,2}$/.test(row.id)
    || !row.title || !['CONTENT','LIVE'].includes(row.courseType) || !Array.isArray(row.targetAudience)) return null;
  // Keep the raw public ID and URL spelling to preserve existing notification IDs.
  const url=allowedUrl('/goe/courses/'+row.id,source);
  if(!url) return null;
  return {sourceId:source.id,source:source.name,engine:'official',checkedAt,url,title:clean(row.title),
    grade:clean([...row.targetAudience.map(audience),row.targetAudienceNote].filter(Boolean).join(', ')),
    days:row.courseType==='LIVE'?(row.classSessionPattern?.daysOfWeek||[]).map(d=>
      ({MONDAY:'월',TUESDAY:'화',WEDNESDAY:'수',THURSDAY:'목',FRIDAY:'금',SATURDAY:'토',SUNDAY:'일'}[d]||d)).join(', '):'',
    applyRange:row.latestEnrollmentRound?.enrollmentPeriod?.startDate&&row.latestEnrollmentRound.enrollmentPeriod.endDate
      ?`${row.latestEnrollmentRound.enrollmentPeriod.startDate} ~ ${row.latestEnrollmentRound.enrollmentPeriod.endDate}`:'',
    activityRange:row.courseType==='CONTENT' && Number.isInteger(row.accessDurationDays)&&row.accessDurationDays>0
      ?`신청일로부터 ${row.accessDurationDays}일`:row.operationPeriod?.startDate&&row.operationPeriod.endDate
        ?`${row.operationPeriod.startDate} ~ ${row.operationPeriod.endDate}`:'',
    status:row.enrollmentApplicationOutlook==='AVAILABLE'?'신청 가능':'',
    place:'온라인',cost:'',mode:row.courseType==='CONTENT'?'self-paced':'online-live',summary:clean(row.categories?.map(c=>c.name).join(' ')),
    evidence:{api:'경기온라인학교 강좌 검색',id:row.id,courseType:row.courseType,targetAudience:row.targetAudience,
      targetAudienceNote:row.targetAudienceNote,lessonCount:row.lessonCount,
      enrollmentApplicationOutlook:row.enrollmentApplicationOutlook,classSessionPattern:row.classSessionPattern,
      operationPeriod:row.operationPeriod,enrollmentPeriod:row.latestEnrollmentRound?.enrollmentPeriod}};
}
export async function expandGoeApi(source,{context,post,maxRequests=8,maxPages=8}={}) {
  const endpoint=new URL('/api/graphql',source.url).href;
  const items=[],failures=[],pages=[],seenIds=new Set(),seenCursors=new Set();
  const courseType=context?.courseType||'CONTENT';
  let requests=0,total=null,after=null,finished=false;
  try {
    if(!context?.tenantId||!context.query) throw new Error('경기온라인학교 최신 목록 요청 문맥 미확인');
    while(requests<maxRequests && pages.length<maxPages) {
      requests++;
      const checkedAt=new Date().toISOString();
      const data=await post(endpoint,source,{operationName:'CourseListPageQuery',query:context.query,
        variables:{first:20,courseType,order:{field:'CURATED',direction:'ASC'},...(after?{after}:{})}},
        {format:'json',tenantId:context.tenantId});
      if(data?.errors?.length) throw new Error('경기온라인학교 목록 API: '+data.errors.map(e=>e.extensions?.code||'GraphQL 오류').join(', '));
      const c=data?.data?.publishedCourses;
      if(!Array.isArray(c?.edges)||!Number.isSafeInteger(c.totalCount)||c.totalCount<0
        ||typeof c.pageInfo?.hasNextPage!=='boolean') throw new Error('경기온라인학교 목록 형식 변경');
      if(total!==null && total!==c.totalCount) throw new Error('경기온라인학교 조회 중 전체 건수 변경: 재조회 필요');
      total=c.totalCount;
      const batch=c.edges.map(e=>e.node?.courseType===courseType?goeApiItem(e.node,source,checkedAt):null);
      if(batch.some(i=>!i)) throw new Error('경기온라인학교 강좌 필드·유형 오류');
      for(const item of batch) {
        if(seenIds.has(item.url)) throw new Error('경기온라인학교 페이지 간 강좌 중복: 재조회 필요');
        seenIds.add(item.url);
      }
      items.push(...batch);
      pages.push({page:pages.length+1,checkedAt,count:batch.length,endCursor:c.pageInfo.endCursor,
        hasNextPage:c.pageInfo.hasNextPage,totalCount:total});
      if(!c.pageInfo.hasNextPage) {
        if(items.length!==total) throw new Error('경기온라인학교 전체 건수와 수집 건수 불일치');
        finished=true;break;
      }
      const cursor=c.pageInfo.endCursor;
      if(!batch.length || typeof cursor!=='string' || !cursor || seenCursors.has(cursor))
        throw new Error('경기온라인학교 다음 페이지 커서 진행 불가');
      seenCursors.add(cursor);after=cursor;
    }
  } catch(e) {failures.push({url:endpoint,error:e.message});}
  const pendingApi=finished?0:Math.max(1,total===null?1:Math.ceil((total-items.length)/20));
  return {items,failures,requests,pendingApi,queries:[{term:courseType==='CONTENT'?'콘텐츠 강좌':'실시간 강좌',total,fetched:items.length,
    pendingPages:pendingApi,completeListing:finished,pages}]};
}
