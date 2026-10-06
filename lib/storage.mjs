import {open,rename,unlink,readFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
let persistenceHook;
export function setPersistenceHook(hook) { persistenceHook=hook; }
export async function atomicJson(path, data) {
 const target=path instanceof URL?fileURLToPath(path):path;
 await mkdir(dirname(target),{recursive:true});
 const temp=target+'.'+randomUUID()+'.tmp';
 const file=await open(temp,'wx');
 try {await file.writeFile(JSON.stringify(data,null,2)+'\n','utf8');await file.sync();} finally {await file.close();}
 try {await rename(temp,target);} catch(e) {await unlink(temp).catch(()=>{});throw e;}
 if(persistenceHook)await persistenceHook(target,data);
}
export async function readJson(path, fallback) {
 try {return JSON.parse(await readFile(path,'utf8'));} catch(e) {if(e.code==='ENOENT') return fallback;throw new Error('JSON 파일 손상 또는 읽기 실패: '+(path instanceof URL?fileURLToPath(path):path));}
}
export async function withLock(path, fn) {
 let file;
 try {file=await open(path,'wx');} catch(e) {if(e.code==='EEXIST')throw new Error('실행 잠금 존재: 실행 중인 프로세스 또는 중단 기록 확인 필요');throw e;}
 try {await file.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));return await fn();}
 finally {await file.close();await unlink(path);}
}
