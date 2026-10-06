export function runtimeDecision(settings, runtime='pc', repository='') {
 const owner=settings.executionOwner || 'pc';
 if(!['pc','github-actions'].includes(owner))throw new Error('실행 주체 설정 오류');
 if(owner!==runtime)return {run:false,reason:'다른 실행 주체가 운영 중'};
 if(runtime==='github-actions' && (!settings.cloudRepository || settings.cloudRepository!==repository))throw new Error('클라우드 저장소 불일치');
 return {run:true};
}
