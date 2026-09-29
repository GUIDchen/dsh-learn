// 学习核心域路由：题库快照（bootstrap）、开练（drill）、历史、排行、进度、每日一题、报告、
// 学习计划、备份导入导出、判定（check）、只读验证（verify）、执行后端（runners）。
//
// 与其它 routes 同一套约定：整域移交，返回值表示「是否已回过响应」。
// 动作实现在 learn-actions.mjs（13 个动作 + 变体题 helper），这里只做**表驱动分发**：
// 键是「方法 + 路径」，与改造前的 if 链逐条对应——加接口从此只加表里一行。
import { ROUTES } from './learn-actions.mjs';

export async function handleLearnRoute(c) {
  const { req, res, url, pathname, serverPlatform } = c;  // serverPlatform：bootstrap/verify 要标明服务端平台
  let sent = false;
  const sendJson = function (response, code, payload) { sent = true; return c.sendJson(response, code, payload); };
  const readBody = c.readBody;
  const readLargeBody = c.readLargeBody || c.readBody;
  const run = async function () {
    const handler = ROUTES[req.method + ' ' + pathname];
    if (!handler) return;
    await handler({
      sendJson: sendJson, req: req, res: res, url: url, pathname: pathname,
      serverPlatform: serverPlatform, readBody: readBody, readLargeBody: readLargeBody
    });
  };
  await run();
  return sent;
}
