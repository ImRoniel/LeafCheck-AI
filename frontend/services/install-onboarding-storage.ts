import type { IntroStorage } from './install-onboarding-store';
const key = 'leafcheck.install-intro.v1';
/** Browser-local only; native resolution uses the .native adapter. */
export const introStorage: IntroStorage = {
  async read() { return globalThis.localStorage.getItem(key); },
  async write(record) { globalThis.localStorage.setItem(key, record); },
};
