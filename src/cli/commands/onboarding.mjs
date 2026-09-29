// 首次运行引导：看「六步走到哪了」，并给出下一步的确切命令（CLI / 接口 / 网页 / 原生同一份口径）。
import { onboardingState } from '../../core/onboarding.mjs';
import { load, readGoals, homeDir } from '../../store.mjs';
import { listProjects } from '../../core/project.mjs';
import { backupStatus } from '../../core/backup.mjs';
import { detectPlatform } from '../../core/platform.mjs';

export function onboardingFacts() {
  const projects = listProjects({});
  return {
    platform: detectPlatform(),
    records: load().records.length,
    projects: projects.length,
    projectsWithSources: projects.filter(function (row) { return (row.sources || []).length > 0; }).length,
    dailyTasks: readGoals().dailyTasks,
    backupExists: backupStatus(homeDir()).exists
  };
}

export async function start(ctx) {
  const { args, asJson, out } = ctx;
  const state = onboardingState(onboardingFacts());
  if (asJson) { out(state); return state.finished ? 0 : 1; }
  process.stdout.write(state.markdown);
  return state.finished ? 0 : 1;
}
