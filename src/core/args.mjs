// 极简参数解析：--key=value、--key value、--flag 三种形式都支持。
// 只有 valueFlags 里的键会吃掉下一个 token，避免把命令正文当成参数值。
export function parseArgs(argv, valueFlags) {
  const flags = valueFlags || [];
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.indexOf('--') === 0) {
      const parts = item.slice(2).split('=');
      const key = parts[0];
      const next = argv[i + 1];
      if (parts.length > 1) {
        out[key] = parts.slice(1).join('=');
      } else if (flags.indexOf(key) > -1 && next && next.indexOf('--') !== 0) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(item);
    }
  }
  return out;
}
