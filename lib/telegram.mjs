export function telegramClient({token,chatId}, request=fetch) {
  if (!token || !chatId) throw new Error('Telegram 로컬 자격 증명 미설정');
  return async (method,body={}) => {
    let response, data;
    try {
      response=await request(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      data=await response.json();
    } catch { throw new Error('Telegram 네트워크/응답 오류: 전송 결과 불명'); }
    if(!data.ok) throw Object.assign(new Error(`Telegram 요청 거절: ${data.error_code || response.status}`),{definitelyNotSent:true});
    return data.result;
  };
}
