const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports;
}

const ids = load('src/lib/preparation-id.ts');
test('event identifier is stable, path-safe and requires a source event', () => {
  assert.equal(ids.preparationId(' 21232925 '), 'agenda-21232925');
  assert.equal(ids.preparationId('a/b'), 'agenda-a%2Fb');
  for (const value of ['', ' ', 'null', 'undefined']) {
    assert.throws(() => ids.preparationId(value), /sem numero/);
  }
});

test('reimport at another row reads the same chip without overwriting or writing history', async () => {
  const documents = new Map();
  let reads = 0, writes = 0;
  const service = load('src/services/basic-preparation.ts', {
    '@/lib/preparation-id': ids,
    '@/lib/firebase/client': { getFirebaseDb: () => ({}) },
    '@/lib/firebase/collections': { collections: { vehiclesFlow: 'vehiclesFlow', flowEvents: 'flowEvents' } },
    'firebase/firestore': {
      doc: (_, collection, id) => `${collection}/${id}`,
      serverTimestamp: () => 'SERVER_TIME',
      runTransaction: async (_, run) => run({
        get: async ref => {
          reads++;
          return { exists: () => documents.has(ref), data: () => documents.get(ref) };
        },
        set: (ref, data) => { writes++; documents.set(ref, data); },
      }),
    },
  });
  const vehicle = {
    id: '21232925-10', eventId: '21232925', client: 'Teste', technician: 'Wesley',
    appointmentDate: '2026-10-20', appointmentTime: '10:00',
  };
  await service.saveBasicPreparedVehicle(vehicle);
  assert.equal(reads, 1);
  assert.equal(writes, 2);
  const saved = documents.get('vehiclesFlow/agenda-21232925');
  saved.currentLane = 'em_servico';
  await service.saveBasicPreparedVehicle({ ...vehicle, id: '21232925-9', sourceFileName: 'outro.xls' });
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(saved.currentLane, 'em_servico');
  assert.equal(saved.appointmentId, 'agenda-21232925');
  await assert.rejects(() => service.saveBasicPreparedVehicle({ ...vehicle, eventId: '' }), /sem numero/);
  assert.equal(reads, 2);
  await service.saveBasicPreparedVehicle({ ...vehicle, eventId: '21291888' });
  assert.equal(documents.size, 4);
});
