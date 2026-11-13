// The bridge from electron/preload.cjs.
export type Action = { thought?: string; action: string; element?: number; text?: string; url?: string; direction?: string; key?: string; answer?: string; question?: string };
export type Step = { n: number; kind: 'action' | 'done' | 'ask' | 'confirm' | 'refused' | 'blocked' | 'error' | 'stuck'; thought?: string; action?: Action; describe?: string; url: string; screenshot?: string; result?: string };
export type Settings = { model: string; allowSensitive: boolean; blocked: string[]; startUrl: string; hasKey: boolean; secureStorage?: boolean };
export type RunSummary = { id: string; task: string; status: string; startedAt: number; steps: number; answer: string | null };
export type Run = RunSummary & { steps: Step[]; reason?: string };
export type Ask = { id: string; kind: 'confirm' | 'ask'; text: string };
export type End = { id: string; status: string; answer: string | null; reason: string | null; steps: number };

type Off = () => void;
declare global {
  interface Window {
    taskpilot: {
      getSettings(): Promise<Settings>;
      setSettings(p: Partial<Settings> & { key?: string }): Promise<Settings>;
      setViewBounds(b: { x: number; y: number; width: number; height: number }): Promise<void>;
      go(url: string): Promise<{ ok: boolean; reason?: string }>;
      back(): Promise<void>;
      showView(on: boolean): Promise<void>;
      start(task: string): Promise<{ ok: boolean }>;
      stop(): Promise<void>;
      answer(id: string, reply: boolean | string | null): Promise<void>;
      listRuns(): Promise<RunSummary[]>;
      getRun(id: string): Promise<Run | null>;
      deleteRun(id: string): Promise<void>;
      onStep(fn: (s: Step) => void): Off;
      onAsk(fn: (a: Ask) => void): Off;
      onEnd(fn: (e: End) => void): Off;
      onUrl(fn: (u: string) => void): Off;
      onBlocked(fn: (b: { url: string; reason: string }) => void): Off;
      onStopping(fn: (why: string) => void): Off;
    };
  }
}
export const tp = () => window.taskpilot;
