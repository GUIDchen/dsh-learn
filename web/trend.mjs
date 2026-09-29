// 网页版进度趋势卡片：从 /api/scorecard 取数据，在右栏画一个纯 SVG 柱状图，并提供成绩单下载。
// 不动 index.html（那次的教训：全页替换很容易匹配到脚本模板），全部 DOM 在 JS 里建。
export function initTrend(deps) {
  const api = deps.api;
  const escapeText = deps.escapeText;

  function bars(series) {
    const max = series.reduce(function (m, row) { return Math.max(m, row.passed); }, 0) || 1;
    const width = 8;
    const gap = 2;
    const height = 48;
    let out = '';
    series.forEach(function (row, index) {
      const h = Math.round((row.passed / max) * height);
      const x = index * (width + gap);
      out += '<rect x="' + x + '" y="' + (height - Math.max(1, h)) + '" width="' + width + '" height="' + Math.max(1, h) + '"></rect>';
      out += '<title>' + escapeText(row.date + '：通过 ' + row.passed + ' / 尝试 ' + row.attempts) + '</title>';
    });
    return { svg: '<svg class="trend-svg" width="' + (series.length * (width + gap)) + '" height="' + height + '" role="img">' + out + '</svg>', max: max };
  }

  async function load() {
    const box = document.getElementById('trendBox');
    if (!box) return;
    try {
      const card = await api('/api/scorecard?days=14');
      const chart = bars(card.series || []);
      let html = '<div class="muted">最近 14 天：练习 ' + card.totals.attempts + ' 次，通过 ' + card.totals.passed
        + ' 次（' + Math.round(card.totals.passRate * 100) + '%）　连续 ' + card.totals.streak + ' 天</div>';
      html += chart.svg;
      html += '<div class="muted" id="trendHint">柱子=当天通过数，悬停看当天明细</div>';
      html += '<button type="button" id="trendDownload" class="theme-toggle">下载成绩单</button>';
      box.innerHTML = html;
      const button = document.getElementById('trendDownload');
      if (button) {
        button.addEventListener('click', async function () {
          const full = await api('/api/scorecard?days=30');
          const text = deps.markdown ? deps.markdown(full) : JSON.stringify(full, null, 2);
          const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = '成绩单.md';
          a.click();
          URL.revokeObjectURL(url);
        });
      }
    } catch (err) {
      box.innerHTML = '<div class="warn-text">读趋势失败：' + escapeText(err.message) + '</div>';
    }
  }

  function mount() {
    if (document.getElementById('trendBox')) return;
    const column = document.querySelector('.col-right') || document.querySelector('.col-center') || document.body;
    const details = document.createElement('details');
    details.id = 'trendCard';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = '进度趋势与成绩单';
    const box = document.createElement('div');
    box.id = 'trendBox';
    box.className = 'muted';
    box.textContent = '正在读取…';
    details.appendChild(summary);
    details.appendChild(box);
    column.appendChild(details);
  }

  mount();
  load();
  return { load: load, mount: mount };
}
