const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function setup() {
  const calls = [];
  const services = Object.fromEntries([
    'listDeliveredVehicleFlowsForMonth', 'listDeliveredVehicleFlowsForPeriod',
    'listHgsiRecordsForMonth', 'listHgsiRecords', 'listHgsiAnswersForMonth', 'listPostServiceCasesForMonth',
  ].map(name => [name, async (...args) => { calls.push([name, ...args]); return [{ id: name }]; }]));
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('src/services/post-service-month.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    assert.equal(name, '@/services/firestore'); return services;
  }, mod, mod.exports);
  return { calls, load: mod.exports.loadPostServiceMonth };
}

test('closed month reads only its answers, never vehicles, records, history or treatments', async () => {
  const s = setup();
  const result = await s.load('2026-10', true, { start: '2026-10-08', end: '2026-11-07' });
  assert.deepEqual(s.calls, [['listHgsiAnswersForMonth', '2026-10']]);
  for (const key of ['vehicles', 'records', 'history', 'cases']) assert.deepEqual(result[key], []);
  assert.deepEqual(result.answers, [{ id: 'listHgsiAnswersForMonth' }]);
});

test('open campaign retains its operational date window and month queries', async () => {
  const s = setup();
  await s.load('2026-10', false, { start: '2026-10-08', end: '2026-11-07' });
  assert.deepEqual(s.calls[0], ['listDeliveredVehicleFlowsForPeriod', '2026-10-08', '2026-11-07']);
  assert.equal(s.calls.length, 4);
  assert.ok(s.calls.every(call => call[0] !== 'listHgsiRecords'));
});

test('open month without configured campaign retains monthly vehicle query', async () => {
  const s = setup(); const result = await s.load('2026-11', false);
  assert.deepEqual(s.calls[0], ['listDeliveredVehicleFlowsForMonth', '2026-11']);
  assert.equal(result.history, result.records);
  assert.equal(s.calls.length, 4);
  assert.ok(s.calls.every(call => call[0] !== 'listHgsiRecords'));
});

test('closed campaign UI hides operational funnel and old customer lists', () => {
  const source = fs.readFileSync('src/app/pos-servico/page.tsx', 'utf8');
  assert.match(source, /!campaignClosed && <section className="post-funnel-vertical"/);
  assert.match(source, /!campaignClosed && <div className="answered-client-list"/);
  assert.match(source, /loadPostServiceMonth\(selectedMonth, isCampaignClosed\(selectedMonth\), selectedPeriod\)/);
  assert.match(source, /window.clearTimeout\(timer\)/);
});

test('closed month renders results without operational counts or funnel', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let stateIndex = 0;
  function compile(file, mocks) {
    const mod = { exports: {} };
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function('require', 'module', 'exports', js)(name => mocks[name] ?? require(name), mod, mod.exports);
    return mod.exports;
  }
  const Page = compile('src/app/pos-servico/page.tsx', {
    react: { ...React, useState: initial => {
      const index = stateIndex++;
      return [index === 9 ? '2026-07' : index === 16 ? false : typeof initial === 'function' ? initial() : initial, () => {}];
    } },
    '@/components/protected-page': { ProtectedPage: ({ children }) => children },
    '@/context/auth-context': { useAuth: () => ({ profile: { name: 'Teste', role: 'admin' }, user: { uid: 'test' } }) },
    '@/lib/hgsi/record-status': compile('src/lib/hgsi/record-status.ts', {}),
    '@/services/firestore': {}, '@/services/post-service-month': {},
    './identity': compile('src/app/pos-servico/identity.ts', {}),
  }).default;
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /Indicadores por consultor/);
  assert.match(html, /Pesquisas válidas/);
  assert.doesNotMatch(html, /post-funnel-vertical|answered-client-list|Veículos entregues|Clientes tratados/);
});
