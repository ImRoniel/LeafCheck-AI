import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import ts from 'typescript';
const requireModule = createRequire(import.meta.url);
type NodeProps = { children?: React.ReactNode; guard?: boolean; name?: string; title?: string; screenOptions?: { animation: string }; href?: string };
type Element = React.ReactElement<NodeProps>;
export function nodes(node: React.ReactNode): Element[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement<NodeProps>(child) ? [child, ...nodes(child.props.children)] : []);
}
export function loadComponent(path: string, overrides: Record<string, unknown>, effects: (() => void)[] = [], globals: Record<string, unknown> = {}) {
  const exports: { default?: () => Element } = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, setTimeout, clearTimeout, ...globals, require: (name: string): unknown => {
      if (name in overrides) return overrides[name];
      if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: async () => "true" } };
      if (name === "expo-secure-store") return { getItemAsync: async () => "access-fixture" };
      if (name === 'react') return { ...React, useState: () => [true, () => {}], useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effects.push(effect) };
      if (name === 'react/jsx-runtime') return requireModule(name);
      if (name === 'react-native') return { ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  assert.ok(exports.default);
  return exports.default;
}
export function rootRoute(auth: { status: string; isGuest?: boolean; isLoading?: boolean }, local = { ready: true, error: null as string | null, data: { onboarding: { status: 'completed' } } }, reduced = false) {
  const effects: (() => void)[] = [];
  const replacements: string[] = [];
  const Layout = loadComponent('app/_layout.tsx', {
    '@/context/install-onboarding': { InstallOnboardingProvider: 'InstallOnboardingProvider', useInstallOnboarding: () => ({ phase: 'completed' }) },
    './splash': { __esModule: true, default: 'Splash' },
    '@/components/screen': { Screen: 'Screen', Notice: 'Notice', Action: 'Action' },
    '@/context/auth': { AuthProvider: 'AuthProvider', useAuth: () => ({ ...auth, status: auth.status === "anonymous" ? "signedOut" : auth.status }) },
    '@/context/local-state': { LocalStateProvider: 'LocalStateProvider', useLocalState: () => local },
    '@/context/app-data': { AppDataProvider: 'AppDataProvider' },
    '@/hooks/use-reduced-motion': { useReducedMotion: () => reduced },
    'expo-router': { Stack: Object.assign(() => null, { Protected: 'Protected', Screen: 'Screen' }), useRouter: () => ({ replace: (path: string) => replacements.push(path) }), useRootNavigationState: () => ({ key: 'ready' }) },
  }, effects);
  let route = Layout();
  for (let depth = 0; depth < 12 && !route.props.screenOptions && !route.props.title && route.type !== 'Splash'; depth++) {
    if (typeof route.type === 'function') {
      route = (route.type as (props: NodeProps) => Element)(route.props);
    } else {
      const child = React.Children.toArray(route.props.children)[0];
      assert.ok(React.isValidElement<NodeProps>(child));
      route = child;
    }
  }
  return { route, effects, replacements };
}
export function available(route: Element) {
  return nodes(route).filter(n => n.props.guard === true).flatMap(n => nodes(n.props.children).map(c => c.props.name).filter(Boolean));
}
