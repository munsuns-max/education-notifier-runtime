import { parseBoard, parseDetail } from './boards.mjs';
import { allowedUrl } from './http.mjs';
import { clean, document, fieldsFrom, normalizeDates, canonicalUrl, hash } from './content.mjs';
import {lgListing,lgDetail} from './lg-discovery.mjs';
import {load} from 'cheerio';

const unique = items => [...new Map(items.filter(i => i.url && i.title).map(i => [canonicalUrl(i.url), i])).values()];
const baseItem = (source, checkedAt, data) => ({ sourceId: source.id, source: source.name, engine: 'official',
  checkedAt, grade: '', days: '', applyRange: '', activityRange: '', status: '', place: '', cost: '', summary: '', ...data });
const dateRange = text => normalizeDates(text).match(/\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\s*~\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?/)?.[0] || '';

function detailFromFields(fields) {
  const get = (...keys) => keys.map(k => fields[k]).find(Boolean) || '';
  const time = get('수업시간', '교육시간', '학습시간');
  return { grade: get('모집대상', '수강대상', '교육대상', '대상', '학습대상'), days: get('수업요일', '교육요일', '교육일정') || /\(([월화수목금토일,\s]+)\)/.exec(time)?.[1] || '',
    applyRange: dateRange(get('수강신청기간', '신청기간', '일반신청기간', '접수기간', '모집기간')) || normalizeDates(get('수강신청기간', '신청기간', '일반신청기간', '접수기간', '모집기간')),
    activityRange: normalizeDates(get('수업기간', '교육기간', '강좌운영기간', '학습기간', '수강기간')),
    classTime: time.match(/\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/)?.[0] || time, status: get('모집상태', '프로그램상태', '접수상태'),
    place: get('교육장소', '장소', '수업장소'), cost: [get('참가비', '수강료', '교육비', '학습비'),
      fields['재료비'] && '재료비 ' + fields['재료비']].filter(Boolean).join('; '),
    requirements: [get('신청자격', '지원자격'), get('상세', '대상상세'), get('신청방법'), get('선수지식', '선수학습', '필요실력')].filter(Boolean).join('; '),
    requiredSchedule: get('필수일정'),
    skillDescription: ['교육내용','강좌소개','학습내용','학습목표','강좌목표','강좌설명','내용'].map(k=>fields[k]).filter(Boolean).join('; '),
    difficulty: get('난이도'), lessonInfo: get('차시수','차시','주차'),
    prerequisites: get('선수지식','선수학습','선수요건','필요실력'), evidence: fields };
}
function attachments($, root, base) {
  const result = [];
  root.find('a[href],img[src]').each((_, e) => {
    const raw = $(e).attr(e.tagName === 'img' ? 'src' : 'href');
    if(e.tagName==='img' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/\s]+={0,2}$/i.test(raw || '')) {
      const [prefix,data]=raw.split(',');
      // Keep a compact reference, never megabytes of base64 in candidate reports.
      result.push({type:'image',url:base.split('#')[0]+'#embedded-'+hash(raw).slice(0,20),embedded:true,
        mimeType:prefix.slice(5,prefix.indexOf(';')).toLowerCase(),encodedChars:data.replace(/\s/g,'').length,text:clean($(e).attr('alt'))});
      return;
    }
    if (e.tagName !== 'img' && !/\.pdf(?:[?#]|$)|download|fileDown/i.test(raw || '')) return;
    try {
      const u = new URL(raw, base);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
      if (e.tagName === 'img' && /logo|icon|btn_|banner|footer|thumbnailFile|\/images\/common\//i.test(u.href)) return;
      result.push({ type: e.tagName === 'img' ? 'image' : 'file', url: u.href, text: clean($(e).attr('alt') || $(e).text()) });
    } catch { /* Invalid links are evidence gaps, never executable URLs. */ }
  });
  return [...new Map(result.map(a => [a.url, a])).values()].slice(0, 30);
}
function genericDetail(html, source, url, selectors, exclusions) {
  const $ = document(html);
  let root;
  for (const selector of selectors) if ($(selector).length) { root = $(selector).first(); break; }
  if (!root) throw new Error('상세 본문 구조를 찾지 못함');
  if(exclusions)root.find(exclusions).remove();
  const fields = fieldsFrom($, root);
  if (!Object.keys(fields).length && clean(root.text()).length < 50 && !root.find('img').length) throw new Error('상세 본문이 비어 있음');
  return { ...detailFromFields(fields), contentText: clean(root.text()).slice(0, 18000), attachments: attachments($, root, url) };
}
function gmYouthList(html, source, at, url) {
  const $ = document(html), items = [];
  $('tbody tr').each((_, row) => {
    const cells = $(row).children('td');
    const link = $(row).find('a[href*="goLectureReceipt"]').attr('href');
    const match = /goLectureReceipt\('(\d+)',\s*'(\d+)'\)/.exec(link || '');
    if (!match || cells.length < 8) return;
    const times = clean(cells.eq(4).text());
    items.push(baseItem(source, at, { title: clean(cells.eq(2).text()),
      url: allowedUrl('./viewLectureWebView.do?key=' + match[2] + '&lectureNo=' + match[1], source, url),
      grade: clean(cells.eq(3).text()), status: clean(cells.eq(1).text()), activityRange: dateRange(times),
      days: /\(([^)]+)\)/.exec(times)?.[1]?.trim() || '', classTime: times.match(/\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/)?.[0] || '',
      applyRange: dateRange(cells.eq(5).text()), cost: clean(cells.eq(7).text()).replace(/^선착순\s*/, ''),
      evidence: { row: clean($(row).text()) } }));
  });
  return unique(items);
}
function goeList(html, source, at, url) {
  const $ = document(html), items = [];
  $('h3 a[href]').each((_, e) => {
    if (!/^\/goe\/courses\/[^/]+$/.test($(e).attr('href'))) return;
    const card = $(e).parent().parent(), text = clean(card.text());
    const grades = card.find('[class*="chip__label"]').toArray().map(x => clean($(x).text())).filter(t => /^[초중고]\s*\d/.test(t));
    items.push(baseItem(source, at, { title: clean($(e).attr('title') || $(e).text()), url: allowedUrl($(e).attr('href'), source, url),
      grade: grades.join(', '), status: /상시\s*수강/.test(text) ? '상시 수강' : '',
      mode: url.includes('/type/content') ? 'self-paced' : 'online-live', place: '온라인',
      activityRange: /상시\s*수강/.test(text) ? '' : text.match(/(?:일정)\s*(.+?)차시/)?.[1]?.trim() || '',
      summary: clean(card.find('[class*="chip__label"]').text()), evidence: { card: text } }));
  });
  return unique(items);
}
function goeDetail(html, source, url) {
  const $ = document(html);
  const main = $('main').first().length ? $('main').first() : $('body');
  if (!main.find('h1').length) throw new Error('강좌 상세 제목을 찾지 못함');
  const fields = {};
  const labels = /^(수강 대상|차시|수강 기간|신청 기간|강좌 목표|강좌 설명|선수 지식|수강료|수강 일정)$/;
  main.find('span,p,div').each((_, e) => {
    if ($(e).children().length || !labels.test(clean($(e).text()))) return;
    const value = clean($(e).next().text());
    if (value) fields[clean($(e).text()).replace(/\s/g, '')] = value;
  });
  const contentText=clean(main.text()).slice(0,14000);
  const selfPacedEvidence=contentText.match(/정해진 일정 없이 자유롭게 학습할 수 있습니다\./)?.[0] || '';
  return { ...detailFromFields(fields), grade: fields['수강대상'] || '', activityRange: fields['수강기간'] || '',
    skillDescription: [fields['강좌목표'], fields['강좌설명']].filter(Boolean).join('; '),
    selfPacedEvidence, contentText, attachments: attachments($, main, url), evidence: fields };
}
function gseekDetail(html,source,url) {
  const $=document(html);
  let root;
  for(const selector of ['.course-detail-container','.course-view','.course-detail','#container','main','#contents'])
    if($(selector).length){root=$(selector).first();break;}
  if(!root)throw new Error('상세 본문 구조를 찾지 못함');
  // Instructor biographies, reviews and related cards are not course requirements.
  root.find('.sec-course-instructor,.sec-course-review,a[href*="/user/course/online/view"]').remove();
  const fields=fieldsFrom($,root);
  if(!Object.keys(fields).length && clean(root.text()).length<50 && !root.find('img').length)throw new Error('상세 본문이 비어 있음');
  const description=clean(root.find('.key-course-info .course-desc').first().text() || root.find('.course-desc').first().text());
  if(description)fields['강좌소개']=description;
  return {...detailFromFields(fields),contentText:clean(root.text()).slice(0,18000),attachments:attachments($,root,url)};
}
function boramaeDetail(html,source,url) {
  const detail=genericDetail(html,source,url,['.AWbbs_view_content']);
  detail.closedEvidence=detail.contentText.match(/(?:접수|모집|신청)(?:가|이|는|은)?\s*마감(?:되었|됐|되었습니다|됐습니다)[^.!?]{0,35}/)?.[0] || '';
  return detail;
}
function gseekList(html, source, at, url) {
  const $ = document(html);
  return unique($('a[href*="/user/course/online/view"]').toArray().map(e => baseItem(source, at, {
    title: clean($(e).find('.course-title').text()), url: allowedUrl($(e).attr('href'), source, url),
    summary: clean($(e).find('.tag-field').text()), place: '온라인', mode: 'self-paced',
    evidence: { card: clean($(e).text()) } })));
}
function ssroList(html, source, at, url) {
  const $ = document(html);
  return unique($('h3 a[href*="edu_view.jsp"]').toArray().map(e => {
    const row = $(e).closest('li'), fields = fieldsFrom($, row), detail = detailFromFields(fields);
    return baseItem(source, at, { ...detail, title: clean($(e).text()), url: allowedUrl($(e).attr('href'), source, url),
      summary: /@|\d{2,3}-\d{3,4}-\d{4}/.test(fields['체험내용'] || '') ? '' : fields['체험내용'] || '',
      status: /상시\s*접수중/.test(fields['신청기간'] || '') ? '상시 접수중' : '',
      evidence: fields });
  }));
}
function boramaeList(html, source, at, url) {
  const $ = document(html);
  return unique($('td.subject a[href*="ptype=view"]').toArray().map(e => baseItem(source, at, {
    title: clean($(e).text()), url: allowedUrl($(e).attr('href'), source, url),
    evidence: { row: clean($(e).closest('tr').text()) } })));
}
function kmoocList(html, source, at, url) {
  const $ = document(html);
  return unique($('a[href^="/view/course/detail/"]').toArray().map(e => {
    const card = $(e);
    return baseItem(source, at, { title: clean(card.find('strong.title').text()) || clean(card.find('.card_img').attr('title')),
      url: allowedUrl(card.attr('href'), source, url), activityRange: dateRange(card.find('.date').text()),
      place: '온라인', mode: 'online', status: clean(card.find('small.class').text()),
      summary: clean(card.find('.institution').text()), evidence: { card: clean(card.text()) } });
  }));
}
function kmoocDetail(html, source, url) {
  const $ = document(html);
  const main = $('main').first();
  if (!main.length) throw new Error('K-MOOC 상세 본문 구조를 찾지 못함');
  // Related course cards must not supply facts about the requested course.
  main.find('.card_item,.card_list').remove();
  const fields = fieldsFrom($, main);
  // Rich course descriptions also use h6 headings and label/value td tables.
  const intro=main.find('.introduce').first();
  const sectionLabels=/^(학습대상|수강대상|선수학습|선수지식|선수요건|학습내용|학습목표|강좌소개|강좌목표)$/;
  intro.find('h2,h3,h4,h5,h6').each((_,e)=>{
    const label=clean($(e).text()).replace(/\s+/g,'');
    if(!sectionLabels.test(label))return;
    const value=clean($(e).nextUntil('h1,h2,h3,h4,h5,h6').text());
    if(value)fields[label]=[fields[label],value].filter(Boolean).filter((v,n,a)=>a.indexOf(v)===n).join('; ');
  });
  intro.find('tr').each((_,row)=>{
    const cells=$(row).children('td,th');
    const label=clean(cells.first().text()).replace(/\s+/g,'');
    if(cells.length===2&&sectionLabels.test(label))fields[label]=clean(cells.eq(1).text());
  });
  main.find('.catagory').each((_, e) => {
    const label = clean($(e).find('b').first().text()).replace(/\s/g, '');
    const value = clean($(e).siblings('.content').text());
    if (label && value) fields[label] = value;
  });
  main.find('span,dt,th').each((_, e) => {
    const label = clean($(e).text()).replace(/\s+/g, '');
    if (!/^(수강신청기간|강좌운영기간|학습인정시간|난이도|주차|운영기관|선수지식|학습대상)$/.test(label)) return;
    const value = clean($(e).next().text());
    if (value) fields[label] = value;
  });
  return { ...detailFromFields(fields), contentText: clean(main.text()).slice(0, 18000),
    attachments: attachments($, main, url), evidence: fields };
}
function officialBoardList(html,source,at,url) {
  const spec=source.boardSpec;
  if(!spec?.links)throw new Error('공식 목록 구조 설정 필요');
  const $=document(html);
  if(spec.singleNotice){
    if(!spec.detailTitle||!spec.detailRoots?.length)throw new Error('독립 모집 안내 구조 설정 필요');
    const title=clean($(spec.detailTitle).first().text());
    const root=spec.detailRoots.map(selector=>$(selector).first()).find(node=>node.length);
    const target=allowedUrl(url,source);
    if(!target||title.length<5||!root||clean(root.text()).length<50)throw new Error('독립 모집 안내 제목·본문 미확인');
    return [baseItem(source,at,{title,url:target,evidence:{listTitle:title,standaloneNotice:true}})];
  }
  return unique($(spec.links).toArray().map(e=>{
    const link=$(e),row=link.closest(spec.row || 'tr,li,article'),titleNode=link.clone();
    if(spec.titleExclude)titleNode.find(spec.titleExclude).remove();
    const title=clean(spec.rowTitle?row.find(spec.rowTitle).first().text():link.attr('title') || (spec.title?titleNode.find(spec.title).first().text():'') || titleNode.text() || link.find('img').attr('alt'));
    let href=link.attr('href');
    if(spec.numericLink) {
      const mapping=spec.numericLink;
      if(!['href','onclick','data-idx'].includes(mapping.attribute) || !mapping.pattern?.startsWith('^') || !mapping.pattern?.endsWith('$') || !mapping.template?.includes('{id}'))throw new Error('공식 숫자 링크 설정 오류');
      if(mapping.idFormat&&!['decimal','base64url-43','econ-program'].includes(mapping.idFormat))throw new Error('공식 게시물 ID 형식 오류');
      const match=new RegExp(mapping.pattern).exec(link.attr(mapping.attribute)||'');
      const validId=mapping.idFormat==='base64url-43'?/^[A-Za-z0-9_-]{43}$/:mapping.idFormat==='econ-program'?/^ECR\d{10}$/:/^\d+$/;
      href=match && validId.test(match[1])?mapping.template.replaceAll('{id}',match[1]):null;
    }
    return baseItem(source,at,{title,url:href?allowedUrl(href,source,url):null,
      status:spec.status?clean(row.find(spec.status).first().text()):'',
      evidence:{listTitle:title,row:clean(row.text()).slice(0,1000)}});
  }));
}
function officialJsonListing(html,source,at,url){
  if(source.boardSpec.jsonList==='kakao-channel')return channelPostListing(html,source,at,url);
  if(source.boardSpec.jsonList!=='ggcf-education'||new URL(url).pathname!=='/api/edus'||!source.allowedHosts.includes('ggcf.kr'))throw new Error('공식 JSON 목록 설정 오류');
  let data;try{data=JSON.parse(html);}catch{throw new Error('공식 JSON 목록 응답 형식 오류');}
  if(!Array.isArray(data.list)||data.list.length>100||!Number.isSafeInteger(data.current_page)||data.current_page<1||!Number.isSafeInteger(data.last_page)||data.last_page<1||!Number.isSafeInteger(data.total)||data.total<0)throw new Error('공식 JSON 목록 구조 오류');
  const items=unique(data.list.filter(i=>i&&i.display==='block'&&typeof i.title==='string'&&typeof i.href==='string').map(i=>baseItem(source,at,{title:clean(i.title),url:allowedUrl(i.href,source,url),status:clean(i.progress),summary:typeof i.summary==='string'?clean(i.summary):'',evidence:{listTitle:clean(i.title)}})));
  const next=[];if(data.current_page<data.last_page){const target=new URL(url);target.searchParams.set('page',String(data.current_page+1));next.push(target.href);}
  const filteredEmpty=data.list.length>0&&!items.length&&data.list.every(i=>i&&['block','none'].includes(i.display)&&typeof i.title==='string'&&typeof i.href==='string');
  const emptyConfirmed=data.total===0&&data.list.length===0||filteredEmpty;
  return {items,next,emptyConfirmed,emptyEvidence:emptyConfirmed?{text:filteredEmpty?`현재 API 페이지의 허용된 본 도메인 상세 링크 0건; 다른 기관·숨김 공고 ${data.list.length}건 제외`:'공식 교육 API total=0',url,scope:'현재 요청한 API 페이지와 허용 호스트 범위만. 전체 모집 없음이 아님.'}:undefined};
}
function channelPostData(html,source,url,detail=false){
  if(source.id!==47||source.allowedChannelPostApi!==true||source.allowedPathPrefix!=='/_iCWBC'||!allowedUrl(url,source))throw new Error('지정 공식 채널 경로 필요');
  const path=new URL(url).pathname;
  if(!(detail?/^\/rocket-web\/web\/profiles\/_iCWBC\/posts\/\d+$/:/^\/rocket-web\/web\/profiles\/_iCWBC\/posts$/).test(path))throw new Error('공식 채널 공개 게시물 GET 경로 오류');
  try{return JSON.parse(html);}catch{throw new Error('공식 채널 JSON 형식 오류');}
}
function publicChannelPost(post){
  return post&&Number.isSafeInteger(post.id)&&post.id>0&&typeof post.title==='string'&&post.title.trim().length>=5
    &&post.is_private===false&&post.adult_only===false&&post.unlisted===false;
}
function channelPostListing(html,source,at,url){
  const data=channelPostData(html,source,url);
  if(!Array.isArray(data.items)||data.items.length>100||typeof data.has_next!=='boolean')throw new Error('공식 채널 목록 구조 오류');
  const items=unique(data.items.filter(p=>publicChannelPost(p)&&p.status==='published').map(p=>{
    const expected=`https://pf.kakao.com/_iCWBC/${p.id}`;
    if(p.permalink!==expected&&p.permalink!==expected.replace('https:','http:'))throw new Error('다른 채널 게시물 혼합 차단');
    return baseItem(source,at,{title:clean(p.title),url:allowedUrl(expected,source),evidence:{listTitle:clean(p.title),postId:p.id,scope:'공식 공개 게시물 첫 페이지만',morePosts:data.has_next}});
  }));
  // The sampled connection covers only this first page, not the whole archive.
  return {items,next:[],emptyConfirmed:data.items.length===0&&!data.has_next};
}
export function sourceDetailUrl(url,source){
  if(source.adapter==='official-board'&&source.boardSpec?.jsonList==='kakao-channel'){
    const checked=allowedUrl(url,source),match=checked&&/^\/_iCWBC\/(\d+)$/.exec(new URL(checked).pathname);
    if(!match||new URL(checked).hostname!=='pf.kakao.com')throw new Error('지정 채널 상세 게시물 링크 필요');
    const target=allowedUrl(`https://pf.kakao.com/rocket-web/web/profiles/_iCWBC/posts/${match[1]}`,source);
    if(!target)throw new Error('공식 채널 상세 GET 경로 차단');
    return target;
  }
  return url;
}
function channelPostDetail(html,source,url){
  const post=channelPostData(html,source,url,true),id=Number(new URL(url).pathname.split('/').at(-1));
  if(!publicChannelPost(post)||post.id!==id||!Array.isArray(post.contents)||post.contents.length>200)throw new Error('공식 채널 공개 상세·ID 불일치');
  const expected=`https://pf.kakao.com/_iCWBC/${id}`;
  if(post.permalink!==expected&&post.permalink!==expected.replace('https:','http:')||!post.author||post.author.is_official!==true
    ||!['https://pf.kakao.com/_iCWBC','http://pf.kakao.com/_iCWBC'].includes(post.author.permalink))throw new Error('공식 광명시도서관 채널 저자 미확인');
  const text=post.contents.filter(p=>p?.t==='text').map(p=>{
    if(typeof p.v!=='string'||p.v.length>100000)throw new Error('공식 게시물 텍스트 구조 오류');return p.v;
  }).join('\n');
  if(text.trim().length<50)throw new Error('공식 게시물 본문 부족');
  // A post can bundle unrelated programs. Keep body evidence, but do not infer
  // one enrollment date, eligibility or total fee across those programs.
  return {...detailFromFields({}),title:clean(post.title),contentText:clean(text).slice(0,18000),attachments:[],
    evidence:{detailTitle:clean(post.title),postId:id,officialChannel:'_iCWBC',bundledNotice:true},bundledNotice:true};
}
function officialBoardDetail(html,source,url) {
  const spec=source.boardSpec;
  if(spec?.jsonList==='kakao-channel')return channelPostDetail(html,source,url);
  if(!spec?.detailRoots?.length || !spec.detailTitle)throw new Error('공식 상세 본문·제목 구조 설정 필요');
  // Boostcourse places the actual course heading inside header.page_header.
  const $=spec.embeddedIntro==='boostcourse-materials'?load(html):document(html),title=clean($(spec.detailTitle).first().text());
  if(title.length<5)throw new Error('상세 게시물 제목 미확인');
  if(spec.embeddedIntro==='boostcourse-materials'){
    if(source.id!==24||new URL(url).hostname!=='www.boostcourse.org'||!/^\/[a-z]{2,8}\d{2,6}\/?$/.test(new URL(url).pathname))throw new Error('공식 소개 JSON 경로 오류');
    const nodes=$('#content .user_info_view._intro input#__MATERIALS[type="hidden"]');
    if(nodes.length!==1)throw new Error('공식 소개 JSON 구조 미확인');
    const raw=nodes.val();
    if(typeof raw!=='string'||raw.length>1_000_000)throw new Error('공식 소개 JSON 크기 오류');
    let materials;try{materials=JSON.parse(raw);}catch{throw new Error('공식 소개 JSON 형식 오류');}
    if(!Array.isArray(materials)||!materials.length||materials.length>100||materials.some(m=>!m||typeof m!=='object'||typeof m.type!=='string'))throw new Error('공식 소개 자료 구조 오류');
    const texts=materials.filter(m=>m.type==='Text'&&m.isCode===false);
    if(!texts.length||texts.some(m=>typeof m.text!=='string'||m.text.length>100_000))throw new Error('공식 소개 본문 미확인');
    // The official renderer initializes Text as isLoaded=true. isShowMaterial
    // controls video/attachment previews, and is not Text visibility permission.
    // Read only public introduction Text data; never execute page scripts.
    const intro=document(texts.map(m=>m.text).join('\n'));
    intro('input,textarea,select,button,[hidden],[aria-hidden="true"]').remove();
    const body=intro('body'),fields=fieldsFrom(intro,body),contentText=clean(body.text());
    if(contentText.length<50)throw new Error('공식 소개 본문이 비어 있음');
    return {...detailFromFields(fields),title,contentText:contentText.slice(0,18000),attachments:attachments(intro,body,url),evidence:{...fields,detailTitle:title,introductionFormat:'public-embedded-Text-materials'},introductionOnly:true};
  }
  const mappedFiles=[];
  if(spec.attributeFiles){
    const mapping=spec.attributeFiles;
    if(mapping.endpoint!=='/file/getFileDownloadAllUser.do'||mapping.directory!=='/tchrComm/noti'||!allowedUrl(mapping.endpoint,source,url))throw new Error('공식 첨부 경로 설정 오류');
    $('a[name="attFile"]').each((_,e)=>{
      const node=$(e),id=node.attr('filenm'),name=node.attr('upldfilenm'),directory=node.attr('filepathtext');
      if(!/^\d{16,20}$/.test(id||'')||directory!==mapping.directory||typeof name!=='string'||name.length>240||/[\u0000-\u001f\u007f\\/]/.test(name)||! /\.(?:pdf|hwp|hwpx|docx|zip)$/i.test(name))return;
      const target=new URL(mapping.endpoint,url);
      target.search=new URLSearchParams({sysFileName:id,uploadFileName:name,filePath:directory,disp:'attachment'}).toString();
      const checked=allowedUrl(target.href,source,url);
      if(checked)mappedFiles.push({type:'file',url:checked,text:clean(name),contentRead:false});
    });
  }
  let detail;
  const body=spec.detailRoots.map(selector=>$(selector).first()).find(node=>node.length);
  if(body&&clean(body.text()).length<50&&!body.find('img').length&&mappedFiles.length){
    // Filenames are attachment references, never tuition, eligibility or application dates.
    detail={...detailFromFields({}),contentText:clean(body.text()),attachments:[],attachmentOnly:true,attachmentContentRead:false};
  }else detail=genericDetail(html,source,url,spec.detailRoots,spec.detailExclude);
  detail.attachments=[...detail.attachments,...mappedFiles];
  return {...detail,title,evidence:{...detail.evidence,detailTitle:title}};
}
export const adapters = {
  'shared-school': { list: parseBoard, detail: parseDetail },
  'gm-youth': { list: gmYouthList, detail: (html, s, u) => genericDetail(html, s, u, ['#contents']) },
  'goe-online': { list: goeList, detail: goeDetail },
  'gseek': { list: gseekList, detail: gseekDetail },
  'ssro': { list: ssroList, detail: (html, s, u) => genericDetail(html, s, u, ['.edu_view', '.edu-view', '#contents', '#content', '.contents']) },
  'boramae': { list: boramaeList, detail: boramaeDetail },
  'kmooc': { list: kmoocList, detail: kmoocDetail },
  'lg-discovery': {list:lgListing,detail:lgDetail},
  'official-board': {list:officialBoardList,detail:officialBoardDetail}
};

export function parseListing(html, source, at, url = source.url) {
  if(source.adapter==='official-board'&&source.boardSpec?.jsonList)return officialJsonListing(html,source,at,url);
  if((source.adapter || source.plannedAdapter)==='lg-discovery')return lgListing(html,source,at,url);
  const adapter = adapters[source.adapter || source.plannedAdapter];
  if (!adapter) throw new Error('미구현 수집기: ' + source.name);
  const items = adapter.list(html, source, at, url);
  const $ = document(html), next = [];
  $('a[href]').each((_, e) => {
    const href = allowedUrl($(e).attr('href'), source, url);
    if (!href || !/[?&](?:page|pageIndex|pageNo)=\d+/.test(href)) return;
    const current = new URL(url), target = new URL(href);
    if (current.pathname.replace(/;jsessionid=[^/]+/, '') !== target.pathname.replace(/;jsessionid=[^/]+/, '')) return;
    if (target.searchParams.get('ptype') === 'view') return;
    // Pagination must preserve the listing's category/filter.
    const pageKeys = /^(page|pageIndex|pageNo)$/;
    const filters = u => [...u.searchParams].filter(([k,v]) => !pageKeys.test(k) && v !== '').sort().map(p => JSON.stringify(p)).join('|');
    if (filters(current) !== filters(target)) return;
    const pageNumber = u => Number([...u.searchParams].find(([k]) => pageKeys.test(k))?.[1] || 1);
    if (pageNumber(target) <= pageNumber(current)) return;
    next.push(href.replace(/;jsessionid=[^?]+/, ''));
  });
  // A zero count alone can be a dynamic placeholder. Require the shared-school
  // server-rendered table and its explicit empty row, within the selected filter.
  const sharedEmpty=(source.adapter||source.plannedAdapter)==='shared-school' && !items.length
    && clean($('#totalSize').text())==='0'
    && $('table.basicTable1 thead').text().includes('프로그램명')
    && $('table.basicTable1 tbody td[colspan]').toArray().some(e=>clean($(e).text())==='조회된 항목이 없습니다.');
  const emptyEvidence=sharedEmpty?{text:'총 게시물 0건; 조회된 항목이 없습니다.',url,
    filters:Object.fromEntries(new URL(url).searchParams),scope:'현재 요청한 목록·필터 범위만'}:undefined;
  return { items, next: [...new Set(next)], emptyConfirmed: Boolean(sharedEmpty || !items.length && /등록된 (?:게시물|프로그램|강좌)(?:이|가) 없습니다|검색 결과가 없습니다/.test(clean($('body').text()))),
    ...(emptyEvidence?{emptyEvidence}:{}) };
}
export function parseSourceDetail(html, source, url) {
  const detail = adapters[source.adapter || source.plannedAdapter].detail(html, source, url);
  if (!Object.values(detail.evidence || {}).some(Boolean) && !detail.contentText?.trim() && !detail.attachments?.length) throw new Error('상세 필드와 본문을 읽지 못함');
  return detail;
}
