import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { createIntroStore } from '../services/install-onboarding-store';
import { introRoot, guardedScreens } from './install-onboarding-test-helpers';

// Render the real startup component with asynchronous storage and hook state.
test('startup checks show splash, then enforce all three flag/token combinations', async () => {
  for (const flag of [null, 'false', 'true']) {
    for (const token of [null, 'stored-access-fixture']) {
      const store = createIntroStore({ async read() { return flag; }, async write() {} });
      await store.load();
      let cursor = 0;
      const slots: unknown[] = [];
      const dependencies: (readonly unknown[])[] = [];
      const effects: (() => void)[] = [];
      let elapse: (() => void) | undefined;
      const react = {
        ...React,
        useState(initial: unknown) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value: unknown) => { slots[index] = value; }];
        },
        useRef(initial: unknown) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = { current: initial };
          return slots[index];
        },
        useEffect(effect: () => void, deps: readonly unknown[]) {
          const index = cursor++;
          const previous = dependencies[index];
          if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
            dependencies[index] = deps;
            effects.push(effect);
          }
        },
      };
      const render = () => {
        cursor = 0;
        const root = introRoot(store.snapshot(), token ? 'authenticated' : 'signedOut', {
          react,
          '@/context/install-onboarding': {
            InstallOnboardingProvider: 'IntroProvider',
            useInstallOnboarding: () => ({ ...store.snapshot(), finishSplash: store.finishSplash }),
          },
          '@react-native-async-storage/async-storage': {
            __esModule: true, default: { getItem: async (key: string) => {
              assert.equal(key, '@leafcheck_onboarding_complete'); return flag;
            } },
          },
          'expo-secure-store': { getItemAsync: async (key: string) => {
            assert.equal(key, 'access_token'); return token;
          } },
        }, [], {
          setTimeout(work: () => void) { elapse = work; return 1; },
          clearTimeout() {},
        });
        effects.splice(0).forEach(effect => effect());
        return root;
      };
      assert.equal(render().type, 'Splash');
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(render().type, 'Splash');
      assert.ok(elapse); elapse();
      render();
      const result = render();
      if (flag !== 'true') assert.deepEqual(guardedScreens(result), ['onboarding']);
      else assert.equal((result.props as { hasToken?: boolean }).hasToken, Boolean(token));
    }
  }
});
