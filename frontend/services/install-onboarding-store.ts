/** Non-secret installation UX state. Never use this to authorize API access. */
export interface IntroStorage {
  read(): Promise<string | null>;
  write(record: string): Promise<void>;
}
export type IntroPhase = 'loading' | 'splash' | 'intro' | 'completed' | 'error';
export interface IntroSnapshot { phase: IntroPhase; saving: boolean; error: string | null }
const completionRecord = JSON.stringify({ version: 1, completed: true });
export function parseIntroRecord(raw: string | null): boolean {
  if (raw === null) return false;
  if (raw.length > 128) throw new Error('Invalid intro record');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid intro record');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.completed !== true || Object.keys(record).length !== 2) throw new Error('Unsupported intro record');
  return true;
}
export function createIntroStore(storage: IntroStorage) {
  let state: IntroSnapshot = { phase: 'loading', saving: false, error: null };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  let writing: Promise<boolean> | null = null;
  const publish = (next: IntroSnapshot) => { state = next; listeners.forEach(listener => listener()); };
  const load = (): Promise<void> => {
    if (loading) return loading;
    // Completion and slide state must not regress on a provider remount.
    if (state.phase === 'completed' || state.phase === 'splash' || state.phase === 'intro') return Promise.resolve();
    publish({ phase: 'loading', saving: false, error: null });
    loading = Promise.resolve().then(async () => {
      try {
        const completed = parseIntroRecord(await storage.read());
        publish({ phase: completed ? 'completed' : 'splash', saving: false, error: null });
      } catch {
        publish({ phase: 'error', saving: false, error: 'Introductory setup could not be loaded. Please retry.' });
      } finally { loading = null; }
    });
    return loading;
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    finishSplash() { if (state.phase === 'splash') publish({ ...state, phase: 'intro' }); },
    complete(): Promise<boolean> {
      if (writing) return writing;
      if (state.phase === 'completed') return Promise.resolve(true);
      if (state.phase !== 'intro') return Promise.resolve(false);
      publish({ phase: 'intro', saving: true, error: null });
      writing = Promise.resolve().then(async () => {
        try {
          await storage.write(completionRecord);
          publish({ phase: 'completed', saving: false, error: null });
          return true;
        } catch {
          publish({ phase: 'intro', saving: false, error: 'Your progress could not be saved. Please try again.' });
          return false;
        } finally { writing = null; }
      });
      return writing;
    },
  };
}
