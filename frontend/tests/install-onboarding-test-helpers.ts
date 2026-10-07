import assert from 'node:assert/strict';
import * as React from 'react';
import { loadComponent, nodes } from './startup-test-helpers';
import type { IntroSnapshot } from '../services/install-onboarding-store';
type Props = { children?: React.ReactNode; guard?: boolean; name?: string; title?: string; currentSlide?: number; saving?: boolean; onLetsGo?: () => void; onGetStarted?: () => void; onNext?: () => void; onPress?: () => void; href?: string };
type Element = React.ReactElement<Props>;
export function introRoot(intro: IntroSnapshot, status: string, extras: Record<string, unknown> = {}) {
  const Layout = loadComponent('app/_layout.tsx', {
    '@/context/install-onboarding': { InstallOnboardingProvider: 'IntroProvider', useInstallOnboarding: () => intro },
    '@/context/auth': { AuthProvider: 'AuthProvider', useAuth: () => ({ status, isLoading: status === 'restoring', isGuest: status === 'guest' }) },
    '@/context/local-state': { LocalStateProvider: 'LocalProvider', useLocalState: () => ({ ready: true, data: { onboarding: { status: 'completed' } } }) },
    '@/context/app-data': { AppDataProvider: 'AppDataProvider' },
    '@/components/screen': { Screen: 'Screen', Notice: 'Notice', Action: 'Action' },
    '@/hooks/use-reduced-motion': { useReducedMotion: () => false },
    './splash': { __esModule: true, default: 'Splash' },
    'expo-router': { Stack: Object.assign(() => null, { Screen: 'Screen', Protected: 'Protected' }), useRootNavigationState: () => ({ key: 'ready' }), useRouter: () => ({ replace() { throw new Error('Unexpected bypass'); } }) },
    ...extras,
  });
  let element: Element = Layout();
  while (typeof element.type === 'string' && element.props.children && !element.props.title) {
    const child = React.Children.toArray(element.props.children)[0];
    assert.ok(React.isValidElement<Props>(child));
    element = typeof child.type === 'function' ? (child.type as (props: Props) => Element)(child.props) : child;
  }
  return element;
}
export function guardedScreens(root: Element) {
  return nodes(root).filter(n => n.props.guard === true).flatMap(n => nodes(n.props.children).map(c => c.props.name).filter(Boolean));
}
