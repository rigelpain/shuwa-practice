/**
 * Live speech-to-text through the browser's Web Speech API. Chrome sends the
 * audio to Google's servers to turn it into text; Safari uses Apple's.
 * TypeScript's DOM library does not describe this API, hence the small
 * interfaces below.
 */

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => Recognition;

function recognitionClass(): RecognitionConstructor | null {
  const w = window as unknown as Record<string, RecognitionConstructor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = (): boolean => recognitionClass() !== null;

export interface ListenerHandlers {
  /** Words heard so far in the sentence being spoken; they may still change. */
  interim(text: string): void;
  /** A finished sentence. */
  final(text: string): void;
  /** Why listening stopped against the user's wishes: 'not-allowed', 'audio-capture', 'network', … */
  error(code: string): void;
  listening(on: boolean): void;
}

/** Keeps listening until stopped, restarting when the browser ends a session on its own. */
export class Listener {
  private recognition: Recognition | null = null;
  private wanted = false;

  constructor(private readonly handlers: ListenerHandlers) {}

  get listening(): boolean {
    return this.wanted;
  }

  start(): void {
    const Ctor = recognitionClass();
    if (!Ctor || this.wanted) return;
    this.wanted = true;
    const r = new Ctor();
    r.lang = 'ja-JP';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (text) this.handlers.final(text);
        } else {
          interim += text;
        }
      }
      this.handlers.interim(interim);
    };
    r.onerror = (event) => {
      // Silence and our own stop() are not failures; anything else ends listening.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.wanted = false;
      this.handlers.error(event.error);
    };
    r.onend = () => {
      if (this.wanted) r.start();
      else this.handlers.listening(false);
    };
    this.recognition = r;
    r.start();
    this.handlers.listening(true);
  }

  stop(): void {
    this.wanted = false;
    this.recognition?.stop();
    this.recognition = null;
    this.handlers.interim('');
  }
}
