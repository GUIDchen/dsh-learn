// 外观偏好（三端共用）：默认跟随系统、可设浅/深、非法值拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-prefs-'));
process.env.DSH_LEARN_HOME = home;
const store = await import('../src/store.mjs');

test('默认跟随系统（auto），且偏好文件按 schema 版本写', function () {
  const prefs = store.readPrefs();
  assert.equal(prefs.theme, 'auto');
  assert.equal(prefs.version, 1);
  assert.equal(store.preferencesPath().indexOf(home), 0, '偏好写在当前 home 里：' + store.preferencesPath());
});

test('设置主题：写盘、读回、并记一条日志', function () {
  const next = store.writePrefs({ theme: 'dark' });
  assert.equal(next.theme, 'dark');
  assert.equal(store.readPrefs().theme, 'dark');
  const onDisk = JSON.parse(readFileSync(store.preferencesPath(), 'utf8'));
  assert.equal(onDisk.theme, 'dark');
  assert.equal(onDisk.version, 1);
  const events = readFileSync(join(home, 'logs', 'dsh.ndjson'), 'utf8');
  assert.ok(events.indexOf('prefs.write') > -1, '设置偏好要留痕（出问题时能查是谁改的）');
});

test('非法主题被拒绝（不写坏文件）', function () {
  assert.throws(function () { store.writePrefs({ theme: 'midnight' }); }, /auto \/ light \/ dark/);
  assert.equal(store.readPrefs().theme, 'dark', '被拒绝后原值不变');
  assert.deepEqual(store.themeValues(), ['auto', 'light', 'dark']);
});

test.after(function () { rmSync(home, { recursive: true, force: true }); });
