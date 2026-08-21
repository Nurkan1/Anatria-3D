import { useCallback, useEffect, useState } from "react";

import { deleteApiKey, hasApiKey, listModels, newRequestId, saveApiKey } from "@/lib/ipc";
import type { AiProvider, Language, UserProfile } from "@/lib/schemas";
import { chatPreferences, patchChatPreferences } from "@/stores/chatPreferences";
import { askToConfirm } from "@/stores/confirmStore";
import { useModelStore } from "@/stores/modelStore";

import { VoiceSettings } from "./VoiceSettings";

const PROVIDERS: { id: AiProvider; label: string }[] = [
  { id: "google", label: "Gemini" },
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "GPT" },
];

const PROFILES: { id: UserProfile; label: string }[] = [
  { id: "layperson", label: "General" },
  { id: "student", label: "Student" },
  { id: "clinician", label: "Clinician" },
];

function KeyStatusBadge({ status }: { status: string }) {
  const style: Record<string, [string, string]> = {
    checking: ["bg-slate-700/40 text-slate-300", "checking"],
    valid: ["bg-emerald-500/15 text-emerald-300", "key valid"],
    invalid: ["bg-rose-500/15 text-rose-300", "key rejected"],
    error: ["bg-amber-500/15 text-amber-300", "unreachable"],
  };
  const entry = style[status];
  if (!entry) return null;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${entry[0]}`}>
      {entry[1]}
    </span>
  );
}

/**
 * `Auto` first, and wider than the rest, because it is the only one of the four
 * that describes a reader the other three cannot. Anatomy students do not come
 * in three languages; someone whose own is not on this row has nothing to press
 * — except this.
 */
const LANGUAGES: { id: Language; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "Answer in whatever language I write in" },
  { id: "bg", label: "BG", title: "Always answer in Bulgarian" },
  { id: "es", label: "ES", title: "Always answer in Spanish" },
  { id: "en", label: "EN", title: "Always answer in English" },
];

interface SettingsDrawerProps {
  provider: AiProvider;
  onProviderChange: (provider: AiProvider) => void;
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  spokenLimit: number;
  onSpokenLimitChange: (limit: number) => void;
  spokenSpeed: number;
  onSpokenSpeedChange: (speed: number) => void;
  spokenVolume: number;
  onSpokenVolumeChange: (volume: number) => void;
}

/**
 * Provider, audience and language, plus credential management.
 *
 * Collapsed by default and opened automatically when the chosen provider has no
 * key: the settings are a once-per-setup concern, but a missing key is the one
 * thing that stops the panel working, so it should not be hidden behind a
 * disclosure the user has no reason to open.
 *
 * **Whether it is open is remembered, and the automatic open is not.** Those
 * two rules together are the whole design. Without the first, collapsing it was
 * a decision the application forgot immediately. Without the second, a single
 * assist would have written itself into the reader's preferences and reopened
 * the panel forever — and `keyring_store::exists` reports absence for *any*
 * failed read, so "no key" is not always true.
 */
export function SettingsDrawer({
  provider,
  onProviderChange,
  profile,
  onProfileChange,
  language,
  onLanguageChange,
  spokenLimit,
  onSpokenLimitChange,
  spokenSpeed,
  onSpokenSpeedChange,
  spokenVolume,
  onSpokenVolumeChange,
}: SettingsDrawerProps) {
  // Seeded from the reader's own last decision, not from false. The drawer can
  // open itself when a provider has no key, and used to have no way back:
  // whatever opened it stayed open for the session and returned at the next
  // launch. Only the button below writes this; the automatic open does not.
  const [open, setOpen] = useState(() => chatPreferences().settingsOpen);
  const [keyed, setKeyed] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogue = useModelStore((s) => s.byProvider[provider]);
  const beginCheck = useModelStore((s) => s.beginCheck);
  const selectModel = useModelStore((s) => s.select);
  const resetCatalogue = useModelStore((s) => s.reset);

  const loadModels = useCallback(
    async (target: AiProvider) => {
      const requestId = newRequestId();
      beginCheck(target, requestId);
      try {
        await listModels({ request_id: requestId, provider: target });
      } catch (err) {
        setError(String(err));
      }
    },
    [beginCheck],
  );

  const refresh = useCallback(async () => {
    try {
      const entries = await Promise.all(
        PROVIDERS.map(async ({ id }) => [id, await hasApiKey(id)] as const),
      );
      setKeyed(Object.fromEntries(entries));
      setError(null);
    } catch (err) {
      setError(`Credential store unavailable: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasKey = keyed[provider];
  useEffect(() => {
    if (hasKey === false) setOpen(true);
  }, [hasKey, provider]);

  // Fetch the catalogue once per provider that has a key. This is also the key
  // check, so it must run before the user asks their first question rather than
  // letting a bad credential surface as a failed answer.
  const status = catalogue?.status ?? "unknown";
  useEffect(() => {
    if (hasKey && status === "unknown") void loadModels(provider);
  }, [hasKey, status, provider, loadModels]);

  async function store() {
    setBusy(true);
    try {
      await saveApiKey(provider, draft);
      setDraft("");
      resetCatalogue(provider);
      await refresh();
      // Validate immediately: the user just pasted a key and is watching.
      await loadModels(provider);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Recoverable, unlike a note — you can paste the key again — but only if you
   * still have it. Plenty of people keep their only copy here, and a provider
   * that shows a key once at creation will not show it a second time.
   */
  async function clearKey() {
    const confirmed = await askToConfirm({
      title: "Remove this key?",
      // The provider is always one of the three, but the lookup cannot say so;
      // its own id is a truthful last resort rather than an empty quote block.
      subject: PROVIDERS.find((entry) => entry.id === provider)?.label ?? provider,
      body:
        "It is deleted from your operating system's credential manager. The " +
        "assistant stops answering until you paste a key again, and if this is " +
        "your only copy you will need a new one from the provider.",
      confirmLabel: "Remove key",
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await deleteApiKey(provider);
      resetCatalogue(provider);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-slate-800 text-xs">
      <div className="flex items-center gap-1 px-3 py-2">
        {PROVIDERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onProviderChange(id)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
              provider === id
                ? "border-sky-500 bg-sky-500/10 text-sky-300"
                : "border-slate-700 text-slate-400 hover:border-slate-600"
            }`}
          >
            {label}
            <span
              className={keyed[id] ? "text-emerald-400" : "text-slate-600"}
              title={keyed[id] ? "Key stored" : "No key stored"}
            >
              ●
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            setOpen((value) => {
              patchChatPreferences({ settingsOpen: !value });
              return !value;
            })
          }
          className="ml-auto rounded border border-slate-700 px-1.5 py-1 text-[10px] text-slate-400"
          aria-expanded={open}
        >
          {open ? "Hide" : "Settings"}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-800/60 px-3 py-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              Audience
            </p>
            <div className="flex gap-1">
              {PROFILES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onProfileChange(id)}
                  className={`flex-1 rounded border px-1.5 py-1 text-[11px] ${
                    profile === id
                      ? "border-sky-500 bg-sky-500/10 text-sky-300"
                      : "border-slate-700 text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <VoiceSettings
            language={language}
            spokenLimit={spokenLimit}
            onSpokenLimitChange={onSpokenLimitChange}
            spokenSpeed={spokenSpeed}
            onSpokenSpeedChange={onSpokenSpeedChange}
            spokenVolume={spokenVolume}
            onSpokenVolumeChange={onSpokenVolumeChange}
          />

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              Answer language
            </p>
            <div className="flex gap-1">
              {LANGUAGES.map(({ id, label, title }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onLanguageChange(id)}
                  title={title}
                  aria-pressed={language === id}
                  className={`rounded border px-1.5 py-1 text-[11px] ${
                    id === "auto" ? "flex-[1.4]" : "flex-1"
                  } ${
                    language === id
                      ? "border-sky-500 bg-sky-500/10 text-sky-300"
                      : "border-slate-700 text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              {language === "auto"
                ? "The assistant answers in whatever language you write in, and stays in it."
                : "Structures are labelled in Terminologia Anatomica Latin. The assistant renders them into this language for the selected audience."}
            </p>
            {/* Three fixed buttons cannot describe every reader, and the one
                they fail is exactly the one who cannot read the sentence above.
                Said here because this is where someone comes looking when none
                of the three is theirs. */}
            {language !== "auto" && (
              <p className="mt-1 text-[10px] leading-snug text-slate-600">
                Not one of your languages? Press <span className="text-slate-400">Auto</span>{" "}
                — or just write in your own and the assistant will follow.
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              {PROVIDERS.find((entry) => entry.id === provider)?.label} API key
            </p>
            <div className="flex gap-1">
              <input
                type="password"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && draft.trim()) void store();
                }}
                placeholder={keyed[provider] ? "Replace stored key" : "Paste key"}
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => void store()}
                disabled={busy || !draft.trim()}
                className="rounded bg-sky-600 px-2 py-1 text-[11px] disabled:opacity-30"
              >
                Save
              </button>
              {keyed[provider] && (
                <button
                  type="button"
                  onClick={() => void clearKey()}
                  disabled={busy}
                  className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              Stored in your operating system&apos;s credential manager. Nothing in this
              window can read it back — it goes straight to the analysis engine.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Model</p>
              <KeyStatusBadge status={status} />
              {status !== "checking" && keyed[provider] && (
                <button
                  type="button"
                  onClick={() => void loadModels(provider)}
                  className="ml-auto text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-300"
                >
                  Refresh
                </button>
              )}
            </div>

            {!keyed[provider] ? (
              <p className="text-[10px] text-slate-600">Save a key to load the model list.</p>
            ) : status === "checking" ? (
              <p className="text-[10px] text-slate-500">Checking key and loading models…</p>
            ) : catalogue && catalogue.models.length > 0 ? (
              <>
                <select
                  value={catalogue.selected ?? ""}
                  onChange={(event) => selectModel(provider, event.target.value)}
                  className={`w-full rounded border bg-slate-950 px-2 py-1 text-[11px] outline-none focus:border-sky-500 ${
                    catalogue.selected ? "border-slate-700" : "border-amber-600/70"
                  }`}
                >
                  {/* Present only while nothing is chosen. The engine marks a
                      model as the default when it knows that model drives the
                      scene tools; when it marks none, this is an unanswered
                      question and should look like one rather than silently
                      showing whichever id sorted first. */}
                  {!catalogue.selected && <option value="">Choose a model…</option>}
                  {catalogue.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.recommended ? "  ·  default" : ""}
                    </option>
                  ))}
                </select>
                {!catalogue.selected && (
                  <p className="mt-1 text-[10px] leading-snug text-amber-300/90">
                    None of these is the model this build was tested against, so
                    none is recommended. Pick one — if it cannot drive the 3D
                    view, the assistant will say so rather than fail silently.
                  </p>
                )}
                <p className="mt-1 text-[10px] leading-snug text-slate-600">
                  {catalogue.models.length} models available to this key. If one answers
                  &ldquo;high demand&rdquo;, pick another — that is a busy model, not a
                  broken key.
                </p>
                {/* Said at the point of choosing, not only in the guide. The
                    reader who picks the cheapest model and then judges the
                    atlas by what it says is making an attribution error this
                    sentence is the only chance to prevent. */}
                <p className="mt-1 text-[10px] leading-snug text-slate-600">
                  <span className="text-slate-400">This choice sets the quality of
                  the answers.</span> Anatria3D supplies the anatomy, the tools and
                  the rules; the reasoning is the model&apos;s. A small, fast model is
                  cheaper and shallower, and it is likelier to mark the wrong
                  structure.
                </p>
              </>
            ) : (
              <p className="text-[10px] text-rose-300">
                {catalogue?.message ?? "No usable models returned for this key."}
              </p>
            )}
          </div>

          {error && (
            <p className="rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[10px] text-rose-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
