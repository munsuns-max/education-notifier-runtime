export function canResumeEmptyRepository(previous, repository, remote) {
  return previous.repository === repository && previous.repositoryCreated === true &&
    previous.workflowPushed !== true && remote.visibility === 'PUBLIC' &&
    remote.isEmpty === true && !remote.defaultBranchRef?.name;
}

export function deploymentProgress(previous, repository, now = new Date().toISOString()) {
  if (previous.repository && previous.repository !== repository) throw new Error('배포 저장소 기록 불일치');
  return {...previous, recordedAt: now, repository, publicCodeApproved: true,
    pcSchedulePreserved: true, telegramTests: 0, phoneRetests: 0, applicationSubmitted: false,
    attempts: [...(previous.attempts || []), {
      startedAt: now, previousStatus: previous.status || null,
      previousError: previous.error || null, previousFinishedAt: previous.finishedAt || null
    }], error: null, finishedAt: null, status: 'deployment-in-progress'};
}
