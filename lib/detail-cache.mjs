import {readFile,mkdir} from 'node:fs/promises';
import {hash,canonicalUrl} from './content.mjs';
import {atomicJson as atomicWriteJson} from './storage.mjs';
import {interestScore} from './ranking.mjs';
export const detailListingFingerprint=item=>hash([item.sourceId,canonicalUrl(item.url),item.title,item.grade,item.days,
  item.applyRange,item.activityRange,item.status,item.place,item.cost,item.mode,item.summary]);
const pathFor=(dir,item)=>new URL(hash(item.sourceId+':'+canonicalUrl(item.url))+'.json',dir);
export async function loadDetailPage(dir,item,now=new Date(),maxAgeMs=24*3600000) {
  if(!dir||!item.url)return null;
  try {
    const stored=JSON.parse(await readFile(pathFor(dir,item),'utf8'));
    const checked=Date.parse(stored.page?.checkedAt);
    if(stored.fingerprint!==detailListingFingerprint(item)||!Number.isFinite(checked)
      ||checked>now.getTime()||now.getTime()-checked>=maxAgeMs
      ||typeof stored.page.html!=='string'||!stored.page.html.trim())return null;
    return stored.page;
  }catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}
}
export async function saveDetailPage(dir,item,page) {
  if(!dir)return;
  await mkdir(dir,{recursive:true});
  await atomicWriteJson(pathFor(dir,item),{fingerprint:detailListingFingerprint(item),page});
}
export function prioritizeDetails(items) {
  return [...items].sort((a,b)=>Number(b.evaluation?.state!=='excluded')-Number(a.evaluation?.state!=='excluded')
    ||interestScore(b)-interestScore(a)||Number(b.evaluation?.checks.grade?.state==='pass')-Number(a.evaluation?.checks.grade?.state==='pass')
    ||a.id.localeCompare(b.id));
}
