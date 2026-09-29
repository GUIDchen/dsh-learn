// 项目域路由：项目列表 / 详情 / 来源原文，以及项目相关动作（init / import / add / index / drill / jdplan /
// backfill / refresh / rename / delete / tasks）。
//
// 从 web/api.mjs 按域拆出来的第一块。约定：调用方只在 pathname 命中时把整个域交过来，
// 本模块自己负责方法判别与 404；返回值表示「是否已经回过响应」，避免调用方误当未处理而再回一次。
import { ACTIONS, handleProjectGet } from './project-actions.mjs';

export async function handleProjectRoute(c) {
  const { req, res, url, pathname } = c;
  let sent = false;
  // 包一层 sendJson：原逻辑里到处是 return;（处理完就退出），这里靠 sent 把「已回响应」带出去
  const sendJson = function (response, code, payload) { sent = true; return c.sendJson(response, code, payload); };
  const readLargeBody = c.readLargeBody || c.readBody;
  const run = async function () {
      // GET 分支整块搬进 handleProjectGet（里面按原样 sendJson，sent 决定是否已回响应）
      await handleProjectGet({ sendJson: sendJson, req: req, res: res, url: url, body: null, name: null });
      if (sent) return;

    // 这个路由会收 base64 截图，所以用大请求体上限（8MB）而不是全局的 64KB——
    // 否则任何真实截图都会 413（网页版与原生客户端都传不上去；命令行走本地文件，所以这个坑一直没暴露）。
    if (req.method === 'POST' && pathname === '/api/project') {
      const body = await readLargeBody(req);
      const action = body.action || 'add';
      // 批量动作不需要项目名：按目录导入（import）与旧数据回填（backfill）都是"一次处理多个项目"。
      // 之前把项目名校验放在分支之前，网页上的「导入」「回填」按钮一直被 400 挡掉（CLI 不经过这里所以没暴露）。
      // 项目名接受两种字段：name 或 project。
      // 之前只认 name，导致每个用 project 的新动作（drill / jdplan…）上线时都被这道校验挡一次，
      // 逐个往白名单里加动作名是治标——把字段接受齐才是治本。
      const name = String(body.name || body.project || '').trim();
      // 只有真正批量的动作不需要项目名（import 按目录建项目、backfill 全项目补原文）
      const NAME_OPTIONAL = ['import', 'backfill'];
      if (!name && NAME_OPTIONAL.indexOf(action) === -1) { sendJson(res, 400, { error: '缺少项目名（用 name 或 project 字段）' }); return; }
      // 动作表分发：未命中的落到 add（收来源），与改造前的 if 链行为一致
      const handler = ACTIONS[action] || ACTIONS.add;
      await handler({ sendJson: sendJson, req: req, res: res, url: url, body: body, name: name });
      return;
    }
    // 项目里的草案 → 正式包：网页上先看复核提醒，再落到项目目录的 promoted/ 下（不直接写仓库里的 packs/）
  };
  await run();
  return sent;
}
