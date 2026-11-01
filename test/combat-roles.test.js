import test from 'node:test';
import assert from 'node:assert/strict';
import { specializationRole } from '../src/combat-roles.js';

test('clasifica especializaciones por ID independientemente del nombre y default_role', () => {
  for (const [id, role] of [[258, 'dps'], [257, 'healer'], [256, 'healer'], [270, 'healer'], [71, 'dps'], [73, 'tank'], [66, 'tank'], [65, 'healer']]) {
    assert.equal(specializationRole({ currentSpec: { id, name: 'irrelevante', default_role: 'incorrecto' } }), role);
    assert.equal(specializationRole({ currentSpecId: id }), role);
  }
});

test('omite IDs ausentes, desconocidos, mal formados o contradictorios', () => {
  for (const profile of [{}, null, { currentSpec: { id: 99999 } }, { currentSpecId: '258' }, { currentSpec: { id: 258 }, currentSpecId: 257 }]) {
    assert.equal(specializationRole(profile), null);
  }
});
