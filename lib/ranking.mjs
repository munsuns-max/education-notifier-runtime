// Ranking only chooses which uncertain candidate to inspect first; it never approves eligibility.
export function interestScore(item) {
  const text=`${item.title || ''} ${item.summary || ''} ${item.detail?.skillDescription || ''} ${item.detail?.difficulty || ''}`;
  let score=20;
  if(/인공지능|\bAI\b|생성형|창업|경제|금융|투자|주식|코딩|프로그래밍|로봇|메이커|드론|항공|국방|영상|크리에이터|콘텐츠|미디어|과학/i.test(text)) score+=12;
  if(/입문|기초|초급|처음|왕초보|청소년|중학생/i.test(text)) score+=5;
  if(/실습|제작|프로젝트|체험|만들/i.test(text)) score+=5;
  if(/바이브코딩|프로토타입|(?:앱|애플리케이션)\s*(?:개발|제작|만들)/i.test(text)) score+=4;
  if(/업무\s*(?:효율|자동화)|오피스365|오피스 365|직장인|직무|사무실/i.test(item.title || '')) score-=6;
  if(/직무필수|법정|의무|종사자|인력\s*대상|자격증|공무원|강사|부모/i.test(text)) score-=12;
  if(/심화|고급|전문가/i.test(text)) score-=4;
  if(/영화관람|닌텐도|오큘러스/i.test(text)) score-=8;
  if(/기관\s*지원|기관\s*대상|청소년기관|청소년\s*단체|신청학교|단체\s*접수|면접\s*답변|계약\s*작성|직장인|사무실/i.test(`${text} ${item.grade || ''} ${item.detail?.requirements || ''}`)) score-=20;
  return score;
}
