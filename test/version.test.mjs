// 版本号逻辑：发布脚本与测试共用同一份纯函数实现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseVersion, formatVersion, bumpVersion, buildNumber, compareVersions } from '../src/core/version.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('版本解析：只接受 x.y.z，别的都当非法', function () {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, raw: '1.2.3' });
  assert.equal(parseVersion('v1.2.3'), null);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(formatVersion(parseVersion('0.10.7')), '0.10.7');
});

test('版本自增：patch / minor / major 各自把低位清零', function () {
  assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(bumpVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.9.9', 'major'), '1.0.0');
  assert.equal(bumpVersion('1.2.3'), '1.2.4', '默认按 patch 涨');
  assert.throws(function () { return bumpVersion('1.2.3', 'nonsense'); }, /不支持/);
  assert.throws(function () { return bumpVersion('abc', 'patch'); }, /不是 x\.y\.z/);
});

test('构建号单调递增，能塞进 CFBundleVersion', function () {
  assert.equal(buildNumber('0.1.0'), '100');
  assert.equal(buildNumber('0.2.0'), '200');
  assert.equal(buildNumber('1.0.0'), '10000');
  assert.ok(Number(buildNumber('1.2.3')) > Number(buildNumber('1.2.2')));
});

test('版本比较', function () {
  assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.2.0', '0.2.0') === 0);
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0, '两位数补丁号不能被当成字符串比较');
});

test('仓库里的版本号必须三处一致：package.json / Info.plist / 发布记录', function () {
  const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8')).version;
  const plist = readFileSync(ROOT + 'app/macos/Info.plist.template', 'utf8');
  const short = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)[1];
  assert.equal(short, pkg, 'Info.plist 与 package.json 版本号要一致');

  const plistBuild = /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)[1];
  assert.equal(plistBuild, buildNumber(pkg), 'CFBundleVersion 应等于版本号换算出来的构建号');

  const releases = ROOT + 'docs/RELEASES.md';
  if (existsSync(releases)) {
    // 跳过表头，只认真正以版本号开头的记录行
    const rows = readFileSync(releases, 'utf8').split('\n').filter(function (line) { return /^\|\s*\d+\.\d+\.\d+\s*\|/.test(line.trim()); });
    assert.ok(rows.length > 0, '发布记录里至少应有一条带版本号的记录');
    assert.equal(rows[rows.length - 1].split('|')[1].trim(), pkg, '最新发布记录的版本号应等于 package.json：' + rows[rows.length - 1]);
  }
});
