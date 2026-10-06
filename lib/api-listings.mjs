import {allowedUrl} from './http.mjs';
import {clean} from './content.mjs';
import {load} from 'cheerio';

export const kmoocTerms=['AI','인공지능','창업','경제','코딩','로봇','영상','국방','주식','드론'];
export const gseekCategories=[
  ['82','디지털역량'],['93','컴퓨터활용'],['146','취업·창업'],['17','경제/경영'],
  ['47','금융/재테크'],['126','청소년'],['100','영상편집'],['102','프로그래밍']
];
const kst = seconds => {
  const ms=Number(seconds)*1000+9*3600000;
  return seconds && Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime())
    ? new Date(ms).toISOString().slice(0,16).replace('T',' ') : '';
};
const plain = value => clean(load(`<span>${value || ''}</span>`)('span').first().text());
export function gseekApiItem(row, source, checkedAt) {
  if (!row?.d_sbjct_sn || !row?.d_sbjct_nm) return null;
  const path=row.d_sjsg_code
    ? `/user/course/online/view?ref=${encodeURIComponent(row.d_sjsg_code+'_'+row.d_sbjct_sn)}`
    : `/user/course/online/view?s_sbjct_sn=${encodeURIComponent(row.d_sbjct_sn)}&s_sbjct_cycl_sn=${encodeURIComponent(row.d_sbjct_cycl_sn||'1')}`;
  const url=allowedUrl(path,source);
  if (!url) return null;
  return {sourceId:source.id,source:source.name,engine:'official',checkedAt,title:plain(row.d_sbjct_nm),url,
    grade:'',days:'',applyRange:'',activityRange:'',status:row.d_finish_yn==='Y'?'모집 마감':'',
    place:'온라인',cost:'',summary:plain([row.d_clsf_depth1_nm,row.d_head_rel_srch_nm].filter(Boolean).join(' ')),
    mode:'self-paced',evidence:{api:'GSEEK 온라인 목록',id:String(row.d_sbjct_sn)}};
}
export function kmoocApiItem(row, source, checkedAt) {
  if (!Number.isInteger(row?.id) || !row?.fullname) return null;
  const url=allowedUrl(`/view/course/detail/${row.id}`,source);
  if (!url) return null;
  const start=kst(row.enrol_start),end=kst(row.enrol_end);
  return {sourceId:source.id,source:source.name,engine:'official',checkedAt,title:clean(row.fullname),url,
    grade:'',days:'',applyRange:start&&end?`${start} ~ ${end}`:'',
    activityRange:row.study_start&&row.study_end?`${kst(row.study_start)} ~ ${kst(row.study_end)}`:'',
    status:'',place:'온라인',cost:'',summary:clean(row.institution_name),mode:'online',
    evidence:{api:'K-MOOC 강좌 검색',id:String(row.id)}};
}
export async function expandApi(source, {post, maxRequests=16, maxPagesPerQuery=2} = {}) {
  if(!Number.isInteger(maxRequests)||maxRequests<0||!Number.isInteger(maxPagesPerQuery)||maxPagesPerQuery<1)
    throw new Error('공개 목록 API 수집 상한 오류');
  const at=new Date().toISOString(), items=new Map(), failures=[];
  const gseek=source.adapter==='gseek';
  if(!gseek && source.adapter!=='kmooc') return {items:[],failures:[],requests:0,pendingApi:0,queries:[],checkedAt:at};
  const endpoint=gseek?'https://www.gseek.kr/user/course/online/list/search':'https://www.kmooc.kr/json/course/category/search';
  const states=(gseek?gseekCategories:kmoocTerms.map(t=>[t,t])).map(([key,term])=>({key,term,
    total:null,totalPages:null,fetched:0,pages:[],seen:new Set(),done:false,failed:false}));
  let requests=0;
  // Visit every topic/category before spending the budget on its next page.
  for(let page=1;page<=maxPagesPerQuery && requests<maxRequests;page++) {
    for(const s of states) {
      if(requests>=maxRequests) break;
      if(s.done||s.failed) continue;
      requests++;
      const checkedAt=new Date().toISOString();
      try {
        const fields=gseek?{s_sbjct_clsf_sn:s.key,s_sort_by:'3',s_row_start:String(s.fetched+1),s_row_end:String(s.fetched+10)}
          :{mobile:'0',page:String(page),keyword:s.key};
        const data=await post(endpoint,source,fields);
        let rows,batch,total,totalPages;
        if(gseek) {
          if(!Array.isArray(data)) throw new Error('GSEEK 목록 형식 변경');
          rows=data;
          total=rows.length?Number(rows[0].d_total_cnt):s.total??0;
          if(!Number.isSafeInteger(total)||total<0||total<s.fetched+rows.length) throw new Error('GSEEK 전체 건수 오류');
          if(s.total!==null && s.total!==total) throw new Error('GSEEK 조회 중 전체 건수 변경');
          if(rows.length>9||rows.some(r=>Number(r.d_total_cnt)!==total)) throw new Error('GSEEK 페이지 건수 오류');
          if(rows.length<9 && s.fetched+rows.length<total) throw new Error('GSEEK 남은 강좌가 있으나 페이지가 불완전함');
          batch=rows.map(row=>gseekApiItem(row,source,checkedAt));
          totalPages=Math.ceil(total/9);
        } else {
          if(data?.result!=='success'||!Array.isArray(data.list)||!Number.isInteger(data.paging?.pageTotal)
            ||data.paging.pageTotal<0) throw new Error('K-MOOC 검색 형식 변경');
          totalPages=data.paging.pageTotal;rows=data.list;
          if(s.totalPages!==null && s.totalPages!==totalPages) throw new Error('K-MOOC 조회 중 전체 페이지 변경');
          if(data.paging.page!==undefined && data.paging.page!==page) throw new Error('K-MOOC 요청 페이지와 응답 불일치');
          if((totalPages>0&&!rows.length)||(totalPages===0&&rows.length)||rows.length>20)
            throw new Error('K-MOOC 페이지·검색 결과 불일치');
          batch=rows.map(row=>kmoocApiItem(row,source,checkedAt));
        }
        if(batch.some(i=>!i)||new Set(batch.map(i=>i.url)).size!==batch.length
          ||batch.some(i=>s.seen.has(i.url))) throw new Error('목록 강좌 필드 오류 또는 페이지 간 중복');
        s.total=total??null;s.totalPages=totalPages;
        for(const item of batch) {s.seen.add(item.url);if(!items.has(item.url))items.set(item.url,item);}
        s.fetched+=batch.length;
        s.pages.push({page,checkedAt,count:batch.length});
        s.done=page>=totalPages;
      } catch(e) {s.failed=true;failures.push({url:endpoint,error:`${s.term} ${page}페이지: ${e.message}`});}
    }
  }
  const queries=states.map(s=>({term:s.term,...gseek?{total:s.total}:{totalPages:s.totalPages},fetched:s.fetched,
    pendingPages:s.done?0:Math.max(1,s.totalPages===null?1:s.totalPages-s.pages.length),
    queried:s.pages.length>0,failed:s.failed,completeListing:s.done,pages:s.pages}));
  return {items:[...items.values()],failures,requests,pendingApi:queries.reduce((n,q)=>n+q.pendingPages,0),queries,checkedAt:at};
}
