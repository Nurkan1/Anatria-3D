import type { AiProvider, GenderModel, Language, SessionMode, UserProfile } from "@/lib/schemas";

export interface TurnScope {
  sessionId: string;
  sessionRevision: number;
  mode: SessionMode;
  genderModel: GenderModel;
  caseId: string | null;
}

export interface TurnContext extends TurnScope {
  provider: AiProvider;
  model: string | null;
  profile: UserProfile;
  language: Language;
  organIds: readonly string[];
  title: string;
}

export type SpendContext = Pick<TurnContext, "sessionId" | "provider">;
type Entry =
  | { active: true; context: Readonly<TurnContext>; sent: boolean }
  | { active: false; context: Readonly<SpendContext>; sent: true };

export function sameTurnScope(a: TurnScope, b: TurnScope): boolean {
  return a.sessionId === b.sessionId && a.sessionRevision === b.sessionRevision &&
    a.mode === b.mode && a.genderModel === b.genderModel && a.caseId === b.caseId;
}

/** The transcript may disappear; cost attribution must survive until `done`. */
export class TurnRegistry {
  private entries = new Map<string, Entry>();
  private current: string | null = null;

  constructor(
    private scope: () => TurnScope,
    private onInvalidate: (id: string, sent: boolean) => void,
  ) {}

  begin(id: string, context: TurnContext): void {
    this.invalidate();
    this.entries.set(id, {
      context: Object.freeze({ ...context, organIds: Object.freeze([...context.organIds]) }),
      active: true,
      sent: false,
    });
    this.current = id;
  }

  checkScope = (): void => {
    if (!this.current) return;
    const entry = this.entries.get(this.current);
    if (entry?.active && !sameTurnScope(entry.context, this.scope())) {
      this.invalidate();
    }
  };

  accepts(id: string): boolean {
    this.checkScope();
    return this.current === id && this.entries.get(id)?.active === true;
  }

  markSent(id: string): boolean {
    if (!this.accepts(id)) return false;
    this.entries.get(id)!.sent = true;
    return true;
  }

  invalidate(id: string | null = this.current): void {
    if (!id) return;
    const entry = this.entries.get(id);
    if (!entry?.active) return;
    if (this.current === id) this.current = null;
    // A preparation cancelled before dispatch cannot ever produce usage.
    if (!entry.sent) this.entries.delete(id);
    else this.entries.set(id, {
      active: false, sent: true,
      // Cancellation need not produce a terminal frame. Keep only attribution,
      // never a growing collection of abandoned questions and anatomy arrays.
      context: Object.freeze({ sessionId: entry.context.sessionId, provider: entry.context.provider }),
    });
    this.onInvalidate(id, entry.sent);
  }

  /** Claims completion once, including a late completion of a cancelled turn. */
  take(id: string): Entry | undefined {
    this.checkScope();
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (this.current === id) this.current = null;
    return entry;
  }
}
