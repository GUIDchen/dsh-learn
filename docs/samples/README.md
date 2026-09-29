# 语料目录说明

这里放调研用的原始岗位文本，**按分类原封不动保存**（不改写、不摘要），只用于本地调研与出题。

| 路径 | 内容 |
| --- | --- |
| jd-*.txt | 手写的示例岗位（DevOps / 后端 Go / 数据算法），用于功能演示与用例 |
| jd-devops.html | 上面那份 DevOps 岗位的渲染版，用于生成截图测识图 |
| boss/ | 从 BOSS 直聘按分类采集的真实岗位（每类一个子目录，含 index.json 与 manifest.json） |
| boss-survey*.md | 对 boss/ 语料跑出来的调研报告（热度排行 / 通用技能 / 缺口 / 建议） |

## 采集方式

~~~bash
# 需要开着 --remote-debugging-port=9223 且已登录 BOSS 的 Chrome；脚本通过 CDP 使用该会话（不碰账号密码）
node scripts/boss-harvest-keywords.mjs --port=9223 --out=docs/samples/boss --per=10 --delay=2600

# 单类重抓
node scripts/boss-harvest-keywords.mjs --port=9223 --out=docs/samples/boss --per=10 --only=python

# 采完做调研（多目录用逗号分隔）
DIRS=$(ls -d docs/samples/boss/*/ | sed "s|/$||" | paste -sd, -)
node src/cli.mjs survey --dir="$DIRS" --out=docs/samples/boss-survey-all.md
~~~

## 两条实测经验

1. 直接拼 ?query= 的搜索链接会被 BOSS 降级到通用招聘页（10 类里 5 类这样）；脚本会回退到**走站内搜索框**输入关键词。
2. 宽泛关键词（如 AI、人工智能）的搜索结果里混着销售 / 抽卡师 / 漫剧制作这类非技术岗位，且部分页面取不到职位描述正文；
   脚本按「必须有像样的职位描述」清理，被删掉的份数记在 boss/manifest.json 里，不假装都抓到了。
