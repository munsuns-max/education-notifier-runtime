export function telegramClient({token,chatId}, request=fetch) {
  if (!token || !chatId) throw new Error('Telegram 로컬 자격 증명 미설정');
  return async (method,body={}) => {
    if(!['getMe','getUpdates','sendMessage'].includes(method))throw new Error('Telegram 허용하지 않는 메서드');
    if(method==='sendMessage'){
      if(body.chat_id!==undefined&&String(body.chat_id)!==String(chatId))throw new Error('Telegram 기존 수신 대상 불일치');
      body={...body,chat_id:chatId};
    }
    let response, data;
    try {
      response=await request(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      data=await response.json();
    } catch { throw new Error('Telegram 네트워크/응답 오류: 전송 결과 불명'); }
    if(data?.ok===false && Number.isInteger(data.error_code) && data.error_code>=400 && data.error_code<=599) throw Object.assign(new Error(`Telegram 요청 거절: ${data.error_code}`),{definitelyNotSent:true});
    if(data?.ok!==true || data.result===undefined || response.status<200 || response.status>=300)throw new Error('Telegram 응답 형식 오류: 전송 결과 불명');
    return data.result;
  };
}
