import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export function allowedUrl(value, source, base = source.url) {
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!source.allowedHosts.some(h => host === h.replace(/^www\./, ''))) return null;
    if (source.allowedPathPrefix && url.pathname !== source.allowedPathPrefix && !url.pathname.startsWith(source.allowedPathPrefix + '/')) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export async function fetchPage(url, source, {timeoutMs = 18000, maxBytes=8_000_000, cacheDir, allowJavascript=false} = {}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32_000_000)throw new Error('HTML 응답 크기 상한 오류');
  let current = allowedUrl(url, source);
  if (!current) throw new Error('허용한 공식 출처 밖의 주소');
  const checkedAt = new Date().toISOString();
  const signal = AbortSignal.timeout(timeoutMs);
  for (let i=0; i<6; i++) {
    const response = await fetch(current, {
      headers:{'User-Agent':'Mozilla/5.0 (compatible; YouthActivityFinder/0.2)', 'Accept-Language':'ko-KR,ko;q=0.9'},
      redirect:'manual', signal
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const next = allowedUrl(response.headers.get('location'), source, current);
      await response.body?.cancel();
      if (!next) throw new Error('다른 도메인으로 이동: 수동 출처 확인 필요');
      current=next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const type = response.headers.get('content-type') || '';
    if (type && !/text\/|html|json|xml/i.test(type) && !(allowJavascript && /^application\/(?:javascript|x-javascript)(?:;|$)/i.test(type))) { await response.body?.cancel(); throw new Error(`HTML이 아닌 응답: ${type}`); }
    const chunks=[]; let size=0;
    for await (const chunk of response.body) {
      size+=chunk.length;
      if(size>maxBytes) throw new Error(`페이지 크기 제한(${maxBytes/1_000_000}MB)`);
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    const head=bytes.subarray(0,2048).toString('ascii');
    const charset=/charset\s*=\s*["']?([\w-]+)/i.exec(type+' '+head)?.[1] || 'utf-8';
    let html;
    try { html=new TextDecoder(charset).decode(bytes); } catch { html=bytes.toString('utf8'); }
    const page={url:current,requestedUrl:url,checkedAt,html,status:response.status};
    if (cacheDir) {
      await mkdir(cacheDir,{recursive:true});
      const filename=createHash('sha256').update(url).digest('hex').slice(0,16);
      await writeFile(new URL(`${filename}.json`,cacheDir),JSON.stringify(page));
    }
    return page;
  }
  throw new Error('리다이렉트 횟수 초과');
}

export async function postJson(url, source, fields, {timeoutMs = 18000, format = 'form', tenantId} = {}) {
  if (!['form','json'].includes(format)) throw new Error('목록 API 요청 형식 오류');
  const target = allowedUrl(url, source);
  if (!target) throw new Error('허용한 공식 출처 밖의 주소');
  const response = await fetch(target, {
    method:'POST', redirect:'manual', signal:AbortSignal.timeout(timeoutMs),
    headers:{'User-Agent':'Mozilla/5.0 (compatible; YouthActivityFinder/0.2)',
      'Content-Type':format==='json'?'application/json':'application/x-www-form-urlencoded; charset=UTF-8', 'Accept':'application/json',
      'Accept-Language':'ko-KR,ko;q=0.9',
      'Referer':source.collectionUrls?.[0] || source.url,
      ...(tenantId?{'x-tenant-id':tenantId}:{})},
    body:format==='json'?JSON.stringify(fields):new URLSearchParams(fields)
  });
  if (!response.ok || response.redirected || response.status >= 300) {
    await response.body?.cancel(); throw new Error(`목록 API HTTP ${response.status}`);
  }
  const type=response.headers.get('content-type') || '';
  if (!/json/i.test(type)) {await response.body?.cancel();throw new Error('목록 API가 JSON을 반환하지 않음');}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>2_000_000)throw new Error('목록 API 크기 제한(2MB)');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function mapLimit(items, limit, fn) {
  const result=new Array(items.length); let index=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(index<items.length) { const i=index++; result[i]=await fn(items[i],i); }
  }));
  return result;
}
