import test from 'node:test';
import assert from 'node:assert/strict';
import { dueSlots, validateSchedule, processScheduledNotifications } from '../src/services/notificationScheduler.service.js';
const config = { enabled: true, title: 'Hello', message: 'Good morning', target: 'all', channel: 'push', priority: 'normal', morning: '09:00', evening: '18:00' };
test('validates message and distinct ordered slots', () => {
  assert.equal(validateSchedule(config).channel, 'push');
  assert.throws(() => validateSchedule({ ...config, morning: '18:00' }), /valid message/);
  assert.throws(() => validateSchedule({ ...config, message: '' }), /valid message/);
  assert.throws(() => validateSchedule({ ...config, target: 'user', userId: 'bad' }), /valid message/);
});
test('matches Lagos local time and limits late deliveries to ten minutes', () => {
  assert.deepEqual(dueSlots(config, new Date('2026-11-24T08:00:00Z')), [{ slot: 'morning', key: '2026-11-24:morning' }]);
  assert.deepEqual(dueSlots(config, new Date('2026-11-24T17:09:59Z')), [{ slot: 'evening', key: '2026-11-24:evening' }]);
  assert.deepEqual(dueSlots(config, new Date('2026-11-24T17:10:00Z')), []);
});

test('claims a scheduled slot only once across simultaneous workers', async () => {
  const Schedule = (await import('../src/models/notificationSchedule.model.js')).default;
  const Run = (await import('../src/models/notificationScheduleRun.model.js')).default;
  const User = (await import('../src/models/user.model.js')).default;
  const original = { findOne: Schedule.findOne, init: Run.init, create: Run.create, find: User.find };
  let claims = 0; let deliveries = 0;
  try {
    Schedule.findOne = () => ({ lean: async () => config });
    Run.init = async () => {};
    Run.create = async () => { if (claims++) throw Object.assign(new Error('duplicate'), { code: 11000 }); return { save: async () => {} }; };
    User.find = () => ({ select: () => ({ lean: async () => { deliveries++; return []; } }) });
    await Promise.all([processScheduledNotifications(new Date('2026-11-24T08:00:00Z')), processScheduledNotifications(new Date('2026-11-24T08:00:00Z'))]);
    assert.equal(deliveries, 1);
  } finally { Schedule.findOne = original.findOne; Run.init = original.init; Run.create = original.create; User.find = original.find; }
});
