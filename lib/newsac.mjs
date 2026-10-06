import {document,clean,normalizeDates} from './content.mjs';
import {allowedUrl} from './http.mjs';
const stateName=code=>({'C1101':'모집 예정','C1102':'모집 중','C1103':'모집 완료'}[code] || '모집 상태 미확인');
const text=html=>clean(document(String(html || ''))('body').text());
const date=value=>normalizeDates(String(value || '').replace('T',' '));
const range=(start,end)=>start && end?date(start)+' ~ '+date(end):'';
const grade=p=>[['elementarySchool','초등학교'],['middleSchool','중학교'],['highSchool','고등학교']].flatMap(([key,label])=>(p[key] || []).map(r=>label+' '+clean(r.codeInfo?.codeName))).join(', ');
export function newsacPage(data) {
  if(!data || !Array.isArray(data.content) || !Number.isSafeInteger(data.totalCount) || data.totalCount<0 || !Number.isSafeInteger(data.page) || data.page<1 || !Number.isSafeInteger(data.totalPageCount) || data.totalPageCount<0 || data.totalCount>0 && !data.content.length)throw new Error('디지털새싹 목록 JSON 구조 변경·불완전 응답');
  for(const p of data.content)if(!Number.isSafeInteger(p.programId) || p.programId<1 || !clean(p.programName))throw new Error('디지털새싹 프로그램 식별자·제목 미확인');
  return data;
}
export function newsacProgram(data,source,checkedAt) {
  if(!Number.isSafeInteger(data.programId) || !clean(data.programName))throw new Error('디지털새싹 상세 식별자·제목 미확인');
  const url=allowedUrl(`/public/program/list/${data.programId}`,source);
  const body=[data.programIntroduction,data.notification,data.contactUs].map(text).filter(Boolean).join('; ');
  return {sourceId:source.id,source:source.name,engine:'official',checkedAt,url,title:clean(data.programName),
    summary:clean(data.programSummary),grade:grade(data),days:'',cost:'',place:(data.programRegion || []).map(r=>r.codeInfo?.codeName).filter(Boolean).join(', '),
    applyRange:range(data.applyStartDate,data.applyEndDate),activityRange:range(data.educationStartDate,data.educationEndDate),status:stateName(data.operationStatusCode),
    detail:{url:allowedUrl(`/newsac/api/v1/programs/${data.programId}`,source),checkedAt,grade:grade(data),
      cost:'',requirements:data.programTypeCode==='C0101'?'학교 방문형: 학교·학급 단체 신청 대상':'학생 개인 신청 가능 여부·회차별 자격 확인 필요',
      skillDescription:clean(data.programSummary),contentText:body,
      lessonInfo:data.totalEducationClassChapter?`${data.totalEducationClassChapter}차시`:'',
      curriculum:[data.firstCurriculum,data.secondCurriculum,data.thirdCurriculum].map(text).filter(Boolean).join('; '),
      evidence:{statusCode:data.operationStatusCode,programTypeCode:data.programTypeCode,programId:String(data.programId),grade:grade(data)}}};
}
export function newsacCourses(data,program,source,checkedAt) {
  if(!data || !Array.isArray(data.content) || !Number.isSafeInteger(data.totalCount) || data.totalCount<0 || data.totalCount>0 && !data.content.length)throw new Error('디지털새싹 회차 JSON 구조 변경·불완전 응답');
  return data.content.map(course=>{
    if(!Number.isSafeInteger(course.courseId) || course.programId!==Number(program.detail.evidence.programId))throw new Error('프로그램·회차 식별자 불일치');
    const applyRange=range(course.courseGroupApplyStartDate,course.courseGroupApplyEndDate),activityRange=range(course.educationStartDate,course.educationEndDate);
    const sessions=[course.educationStartDate,course.educationEndDate].map(v=>date(v).match(/^\d{4}-\d{2}-\d{2}/)?.[0]).filter(Boolean);
    // The API course URL gives each class a stable identity. The button opens
    // the official public explanation page, never an application submission.
    const url=allowedUrl(`/newsac/api/v1/programs/${course.programId}/courses/${course.courseId}`,source);
    const place=clean([course.educationLocation,course.educationAddress,course.educationAddressDetail].filter(Boolean).join(' '));
    const full=Number.isSafeInteger(course.capacity) && course.capacity>0 && Number.isSafeInteger(course.approvedStudentCount) && course.approvedStudentCount>=course.capacity;
    return {...program,url,officialDetailUrl:program.url,checkedAt,title:`${program.title} (${course.classDivision || course.courseId}반)`,grade:grade(course) || program.grade,
      applyRange,activityRange,place,status:full?'정원 마감':program.status,
      detail:{...program.detail,url,checkedAt,grade:grade(course) || program.grade,applyRange,activityRange,place,sessions:[...new Set(sessions)],
        status:full?'정원 마감':program.status,cost:'',requirements:program.detail.requirements,
        evidence:{...program.detail.evidence,courseId:String(course.courseId),applyRange,activityRange,place,grade:grade(course) || program.grade}}};
  });
}
