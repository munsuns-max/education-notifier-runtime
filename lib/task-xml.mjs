import {escapeHtml} from './content.mjs';

export function checkInterval(settings) {
  const minutes=settings.checkIntervalMinutes;
  if(!Number.isSafeInteger(minutes) || minutes<5 || minutes>1440)
    throw new Error('자동 확인 간격 미확정 또는 오류(5~1440분)');
  return minutes;
}

export function taskXml({settings,day,at,mode,nodePath,scriptPath,workingDirectory}) {
  const repetition=mode==='send' && settings.notificationCadence==='opening'
    ? `<Repetition><Interval>PT${checkInterval(settings)}M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>`:'';
  const args='"'+scriptPath+'" '+(mode==='send'?'run':'collect');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>청소년 활동 탐색기: 신청 시작일 후보 확인, 교육 신청 비활성</Description></RegistrationInfo>
 <Triggers><CalendarTrigger>${repetition}<StartBoundary>${day}T${at}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
 <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><Enabled>false</Enabled><ExecutionTimeLimit>PT30M</ExecutionTimeLimit></Settings>
 <Actions Context="Author"><Exec><Command>${escapeHtml(nodePath)}</Command><Arguments>${escapeHtml(args)}</Arguments><WorkingDirectory>${escapeHtml(workingDirectory)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}
