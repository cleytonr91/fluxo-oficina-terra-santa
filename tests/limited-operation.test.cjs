const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports);
  return mod.exports;
}
const limited = load('src/lib/limited-operation.ts');
const access = load('src/lib/access-control.ts', { '@/lib/limited-operation': limited });
test('only preparation, basic flow and post-service remain available even for admin/custom paths', () => {
  assert.deepEqual(access.allowedPathsForRole('admin'), ['/preparacao', '/fluxo', '/pos-servico']);
  assert.deepEqual(access.allowedPathsForRole('consultor'), ['/fluxo', '/pos-servico']);
  assert.deepEqual(access.allowedPathsForRole('chefe_oficina'), ['/preparacao', '/fluxo']);
  assert.deepEqual(access.allowedPathsForRole('tecnico'), ['/fluxo']);
  assert.equal(access.canAccessPath('admin', '/pecas', ['/pecas']), false);
  assert.equal(access.canAccessPath('admin', '/fluxo'), true);
  assert.equal(access.defaultPathForRole('tecnico'), '/fluxo');
  assert.equal(access.canAccessPath('tecnico', '/operacao-limitada'), true);
});
test('suspended route component is not mounted (no page effects)', () => {
  const { OperationalGate } = load('src/components/operational-gate.tsx', {
    'next/navigation': { usePathname: () => '/pecas' },
    'next/link': { default: props => React.createElement('a', props) },
    '@/context/auth-context': { useAuth: () => ({ profile: { role: 'admin' }, logout() {} }) },
    '@/lib/access-control': access, '@/lib/limited-operation': limited,
    '@/components/auth-gate': { AuthGate: ({children}) => children },
  });
  function DangerousPage() { throw new Error('Suspended page must not execute'); }
  const html = renderToStaticMarkup(React.createElement(OperationalGate, null, React.createElement(DangerousPage)));
  assert.match(html, /temporariamente limitada/);
  assert.match(html, /Pós-serviço/);
});
test('basic preparation has one targeted read and two writes; retry does not overwrite', async () => {
  let saved, reads=0, writes=[];
  const { saveBasicPreparedVehicle } = load('src/services/basic-preparation.ts', {
    'firebase/firestore': {
      doc: (_, collection, id) => `${collection}/${id}`,
      serverTimestamp: () => 'SERVER_TIME',
      runTransaction: async (_, run) => run({ get: async () => { reads++; return { exists: () => Boolean(saved), data: () => saved }; }, set: (ref, data) => { writes.push(ref); if(ref.startsWith('vehiclesFlow/')) saved=data; } }),
    },
    '@/lib/firebase/client': { getFirebaseDb: () => ({}) },
    '@/lib/firebase/collections': { collections: { vehiclesFlow:'vehiclesFlow', flowEvents:'flowEvents' } },
  });
  const v = { id:'event-1', client:'Teste', plate:'ABC1D23', chassi:'', model:'Teste', eventId:'event', phone:'', service:'Revisão', consultant:'Eliane', technician:'', appointmentDate:'2026-09-24', appointmentTime:'09:00', importedNote:'', sourceFileName:'teste.xls', importedBy:'Admin' };
  await saveBasicPreparedVehicle(v);
  assert.equal(reads,1); assert.equal(writes.length,2);
  assert.equal(saved.currentLane,'preparacao_confirmada');
  saved.currentLane='em_servico';
  await saveBasicPreparedVehicle(v);
  assert.equal(reads,2); assert.equal(writes.length,2); assert.equal(saved.currentLane,'em_servico');
  await assert.rejects(()=>saveBasicPreparedVehicle({...v,client:'Outro'}),/Nenhum dado/);
  await assert.rejects(()=>saveBasicPreparedVehicle({...v,appointmentTime:'--:--'}),/horário/);
});
test('each preparation listener is guarded before being subscribed', () => {
  const source=fs.readFileSync(path.join(root,'src/components/preparation-import.tsx'),'utf8');
  for(const effect of source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\},/g)) {
    if(effect[1].includes('subscribe')) assert.match(effect[1],/if \(LIMITED_OPERATION/);
  }
});
