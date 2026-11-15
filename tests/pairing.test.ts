import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stored: null as string | null,
  configure: vi.fn().mockResolvedValue(undefined),
  permission: vi.fn(() => new Promise(() => {})),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => mocks.stored,
  setItemAsync: async (_key: string, value: string) => { mocks.stored = value; },
}));
vi.mock('expo-notifications', () => ({ requestPermissionsAsync: mocks.permission }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { multiRemove: async () => {} } }));
vi.mock('../app/src/native', () => ({ AgentNative: { configure: mocks.configure } }));
vi.mock('expo-crypto', () => ({}));
vi.mock('../app/src/http', () => ({
  RelayError: class extends Error {},
  fetchJSON: async () => ({ deviceId: 'test-device', secret: 'test-secret' }),
}));

import { credentials, pair } from '../app/src/relay';

it('finishes pairing while optional notification registration remains pending', async () => {
  const expected = { relay: 'https://relay.test', deviceId: 'test-device', secret: 'test-secret' };
  await expect(pair(expected.relay, 'test-code')).resolves.toEqual(expected);
  expect(mocks.configure).toHaveBeenCalledWith(expected);
  await expect(credentials()).resolves.toEqual(expected);
  expect(mocks.permission).toHaveBeenCalledOnce();
});
