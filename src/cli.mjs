#!/usr/bin/env node
// 客户端一：CLI 入口。只做三件事：建上下文、查命令表、按返回值决定退出码。
// 具体实现在 src/cli/commands/ 下按主题分文件，公共工具在 src/cli/context.mjs。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, printUsage, CliError } from './cli/context.mjs';
import * as tasks from './cli/commands/tasks.mjs';
import * as verify from './cli/commands/verify.mjs';
import * as learn from './cli/commands/learn.mjs';
import * as store from './cli/commands/store.mjs';
import * as packs from './cli/commands/packs.mjs';
import * as analyze from './cli/commands/analyze.mjs';
import * as projects from './cli/commands/projects.mjs';
import * as jobsCommand from './cli/commands/jobs.mjs';
import * as researchCommand from './cli/commands/research.mjs';
import * as ocrCommand from './cli/commands/ocr.mjs';
import * as understandCommand from './cli/commands/understand.mjs';
import * as flowCommand from './cli/commands/flow.mjs';
import * as describeCommand from './cli/commands/describe.mjs';
import * as surveyCommand from './cli/commands/survey.mjs';
import * as corpusCommand from './cli/commands/corpus.mjs';
import * as doctorCommand from './cli/commands/doctor.mjs';
import * as masteryCommand from './cli/commands/mastery.mjs';
import * as storageCommand from './cli/commands/storage.mjs';
import * as backupCommand from './cli/commands/backup.mjs';
import * as metricsCommand from './cli/commands/metrics.mjs';
import * as onboardingCommand from './cli/commands/onboarding.mjs';
import * as commandsCommand from './cli/commands/commands.mjs';
import * as prefsCommand from './cli/commands/prefs.mjs';
import * as modelCommand from './cli/commands/model.mjs';
import * as scorecardCommand from './cli/commands/scorecard.mjs';
import * as remindCommand from './cli/commands/remind.mjs';

// 命令表：命令名 -> 处理函数。新增命令只改这里，不用再改 if/else 链。
const COMMANDS = {
  list: tasks.list,
  show: tasks.show,
  check: tasks.check,

  verify: verify.verify,
  runners: verify.runners,
  probe: verify.probe,
  selftest: verify.selftest,
  security: verify.security,
  audit: verify.audit,

  progress: learn.progress,
  daily: learn.daily,
  review: learn.review,
  goal: learn.goal,
  note: learn.note,
  report: learn.report,
  plan: learn.plan,
  drill: learn.drill,
  repl: learn.repl,

  board: store.boardCommand,
  export: store.exportCommand,
  import: store.importCommand,

  pack: packs.pack,
  jobs: jobsCommand.jobs,
  search: researchCommand.search,
  ocr: ocrCommand.ocr,
  understand: understandCommand.understand,
  flow: flowCommand.flow,
  describe: describeCommand.describe,
  survey: surveyCommand.survey,
  corpus: corpusCommand.corpus,
  doctor: doctorCommand.doctor,
  mastery: masteryCommand.mastery,
  metrics: metricsCommand.metrics,
  start: onboardingCommand.start,
  commands: commandsCommand.commands,
  prefs: prefsCommand.prefs,
  model: modelCommand.model,
  scorecard: scorecardCommand.scorecardCommand,
  remind: remindCommand.remind,
  storage: storageCommand.storage,
  backup: backupCommand.backup,
  restore: backupCommand.restore,
  research: researchCommand.research,

  analyze: analyze.analyze,
  knowledge: analyze.knowledge,
  modules: analyze.modules,
  'learn-site': analyze.learnSite,
  'learn-repo': projects.learnRepo,
  project: projects.project
};

export function listCommands() {
  return Object.keys(COMMANDS).sort();
}

export async function dispatch(argv) {
  const ctx = createContext(argv);
  const handler = COMMANDS[ctx.command];

  if (ctx.command === 'help' || !handler) {
    if (!handler && ctx.command !== 'help') {
      console.error('未知命令：' + ctx.command + '　可用命令：' + listCommands().join(', '));
    }
    printUsage(ctx);
    return handler ? 0 : (ctx.command === 'help' ? 0 : 2);
  }

  try {
    const code = await handler(ctx);
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    // 用法/参数类错误按约定的退出码结束，其他异常继续往上抛（由入口打印）
    if (err instanceof CliError) {
      console.error(err.message);
      return err.exitCode;
    }
    throw err;
  }
}

// 只有被当作入口直接运行时才执行；被测试 import 时只暴露命令表。
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch (err) {
    return false;
  }
}

if (isMain()) {
  dispatch(process.argv.slice(2)).then(function (code) {
    if (typeof code === 'number' && code !== 0) process.exit(code);
  }).catch(function (err) {
    // 用法类错误（拼错的选项、缺参数）按约定的退出码 2 结束：
    // 之前 createContext 抛出的 CliError 落在这里，被统一当成"命令执行失败"退 1，与其它用法错误的 2 不一致。
    if (err instanceof CliError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    const raw = err && err.message ? err.message : String(err);
    // 文件系统类错误（权限/只读/磁盘满）是最常见的一类：给一句能直接照做的提示
    const hint = /EACCES|EPERM|EROFS|ENOSPC/.test(raw) ? '（检查 DSH_LEARN_HOME 目录的写权限与磁盘空间）' : '';
    console.error('命令执行失败：' + raw + hint);
    process.exit(1);
  });
}
