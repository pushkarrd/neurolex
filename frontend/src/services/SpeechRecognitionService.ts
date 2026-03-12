/**
 * SpeechRecognitionService — Real-time speech-to-text using the browser-native
 * Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Recognises what the user says while reading aloud.
 *
 * Key feature: sequential cursor tracking. As the user reads aloud,
 * the service tracks a reading cursor that advances through the passage.
 * When a word is recognized, it searches near the cursor position first,
 * ensuring the correct occurrence is matched (not a duplicate earlier/later).
 */

// ──────────── Types ────────────

export interface RecognizedWord {
    word: string;
    rawText: string;
    confidence: number;
    timestamp: number;
    isFinal: boolean;
    /** Index into the passage word array, or null if no match */
    matchedIndex: number | null;
}

// ──────────── Service ────────────

/**
 * How far AHEAD of the cursor to look for the next word.
 * Keep small so common words ("the", "a", "is") don't skip ahead.
 */
const FORWARD_WINDOW = 6;

/**
 * How far BEHIND the cursor to look — only used to detect re-reads.
 * Matches behind the cursor are tagged as re-reads and do NOT move
 * the cursor backward, solving the "jumps to previous line" bug.
 */
const BACKWARD_WINDOW = 2;

class SpeechRecognitionService {
    private recognition: SpeechRecognition | null = null;
    isListening = false;
    isSupported = false;
    private initialised = false;
    private wordListeners: Array<(word: RecognizedWord) => void> = [];
    private interimListeners: Array<(text: string) => void> = [];
    private passageWords: string[] = [];
    private restartTimeout: ReturnType<typeof setTimeout> | null = null;
    private consecutiveErrors = 0;
    private lastRestartTime = 0;

    /** Sequential reading cursor — index into passageWords (always moves forward) */
    private cursor = 0;

    /** Track last emitted interim word index to deduplicate rapid interim fires */
    private lastInterimIndex = -1;

    // ──────────── Init ────────────

    private ensureInitialised(): void {
        if (this.initialised) return;
        this.initialised = true;

        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            this.isSupported = false;
            console.warn('[SpeechRecognition] Not supported — voice input disabled');
            return;
        }

        this.isSupported = true;
        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 3;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event: SpeechRecognitionEvent) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];

                let bestTranscript = '';
                let bestConfidence = 0;
                for (let j = 0; j < result.length; j++) {
                    if (result[j].confidence > bestConfidence) {
                        bestConfidence = result[j].confidence;
                        bestTranscript = result[j].transcript;
                    }
                }

                const words = bestTranscript.trim().split(/\s+/);

                for (const rawWord of words) {
                    const cleaned = rawWord.toLowerCase().replace(/[^a-z']/g, '');
                    if (cleaned.length === 0) continue;

                    // Two-phase search: forward-first (normal reading), then backward (re-read)
                    const forwardMatch = this.matchForward(cleaned);
                    const backwardMatch = !forwardMatch ? this.matchBackward(cleaned) : null;
                    const matchResult = forwardMatch || backwardMatch;

                    const recognized: RecognizedWord = {
                        word: matchResult?.word || cleaned,
                        rawText: rawWord,
                        confidence: result.isFinal ? bestConfidence : bestConfidence * 0.7,
                        timestamp: Date.now(),
                        isFinal: result.isFinal,
                        matchedIndex: matchResult?.index ?? null,
                    };

                    // Only advance cursor FORWARD on final results.
                    // Interim results track too — but only the very next word
                    // to keep up with reading speed without wild jumps.
                    if (forwardMatch !== null) {
                        if (result.isFinal) {
                            this.cursor = forwardMatch.index + 1;
                            this.lastInterimIndex = -1;
                        } else if (forwardMatch.index === this.cursor && this.lastInterimIndex !== forwardMatch.index) {
                            // Interim: advance cursor ONLY to the immediate next word (cursor+0)
                            this.cursor = forwardMatch.index + 1;
                            this.lastInterimIndex = forwardMatch.index;
                        }
                    }
                    // Backward matches NEVER move the cursor — they are re-reads

                    for (const cb of this.wordListeners) {
                        cb(recognized);
                    }
                }

                if (!result.isFinal) {
                    for (const cb of this.interimListeners) {
                        cb(bestTranscript.trim());
                    }
                }
            }
        };

        this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error === 'no-speech') return;

            if (event.error === 'not-allowed') {
                this.isSupported = false;
                console.warn('[SpeechRecognition] Permission denied');
                return;
            }

            if (event.error === 'network') {
                console.warn('[SpeechRecognition] Network error — retrying');
            }

            this.consecutiveErrors++;

            if (this.consecutiveErrors > 5) {
                this.isSupported = false;
                console.warn('[SpeechRecognition] Too many errors — disabling voice input');
            }
        };

        this.recognition.onend = () => {
            if (!this.isListening || !this.isSupported) return;

            const now = Date.now();
            const delay = now - this.lastRestartTime < 500 ? 300 : 50;

            this.restartTimeout = setTimeout(() => {
                if (this.isListening && this.isSupported && this.recognition) {
                    this.lastRestartTime = Date.now();
                    try {
                        this.recognition.start();
                    } catch (e) {
                        console.warn('[SpeechRecognition] Restart error:', e);
                    }
                }
            }, delay);
        };
    }

    // ──────────── Controls ────────────

    start(): void {
        this.ensureInitialised();
        if (!this.isSupported || !this.recognition) return;
        if (this.isListening) return;
        this.isListening = true;
        this.consecutiveErrors = 0;
        this.cursor = 0;
        try {
            this.recognition.start();
        } catch (e) {
            console.warn('[SpeechRecognition] Start error:', e);
        }
    }

    stop(): void {
        this.isListening = false;
        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        try {
            this.recognition?.stop();
        } catch { /* ignore */ }
    }

    getIsActive(): boolean {
        return this.isListening && this.isSupported;
    }

    setPassageWords(words: string[]): void {
        this.passageWords = words
            .map(w => w.toLowerCase().replace(/[^a-z']/g, ''))
            .filter(w => w.length > 0);
        this.cursor = 0;
    }

    /** Allow external code to sync the cursor (e.g. from gaze position) */
    setCursor(index: number): void {
        this.cursor = Math.max(0, Math.min(index, this.passageWords.length - 1));
    }

    getCursor(): number {
        return this.cursor;
    }

    // ──────────── Forward / Backward Matching ────────────

    /** Max edit distance for fuzzy matching. Stricter for short words. */
    private maxEditDist(wordLen: number): number {
        if (wordLen <= 2) return 0; // exact only for very short words ("a", "an", "is")
        if (wordLen <= 4) return 1; // "the" → allow 1 edit
        if (wordLen <= 7) return 2;
        return 3;
    }

    /**
     * Search FORWARD from cursor. This is the primary path: the user
     * is reading left-to-right, top-to-bottom. Strongly prefers the
     * word at `cursor` (exact position bonus), then cursor+1, +2, etc.
     */
    private matchForward(
        spoken: string,
    ): { word: string; index: number; distance: number } | null {
        if (this.passageWords.length === 0) return null;

        const lo = this.cursor;
        const hi = Math.min(this.passageWords.length - 1, this.cursor + FORWARD_WINDOW);
        const maxDist = this.maxEditDist(spoken.length);

        // First: exact match AT the cursor (most common case — user reads next word)
        if (lo < this.passageWords.length) {
            const d = this.levenshtein(spoken, this.passageWords[lo]);
            if (d <= maxDist) {
                return { word: this.passageWords[lo], index: lo, distance: d };
            }
        }

        // Then: scan cursor+1 .. cursor+FORWARD_WINDOW
        let bestIndex = -1;
        let bestDist = Infinity;
        let bestWord = '';

        for (let i = lo + 1; i <= hi; i++) {
            const candidate = this.passageWords[i];
            const d = this.levenshtein(spoken, candidate);
            if (d < bestDist) {
                bestDist = d;
                bestIndex = i;
                bestWord = candidate;
            }
        }

        if (bestIndex >= 0 && bestDist <= maxDist) {
            return { word: bestWord, index: bestIndex, distance: bestDist };
        }
        return null;
    }

    /**
     * Search BACKWARD from cursor (re-read path). Only used when forward
     * matching fails. The cursor is NEVER moved backward.
     */
    private matchBackward(
        spoken: string,
    ): { word: string; index: number; distance: number } | null {
        if (this.passageWords.length === 0) return null;

        const lo = Math.max(0, this.cursor - BACKWARD_WINDOW);
        const hi = this.cursor - 1;
        if (lo > hi) return null;

        const maxDist = this.maxEditDist(spoken.length);

        let bestIndex = -1;
        let bestDist = Infinity;
        let bestWord = '';

        for (let i = hi; i >= lo; i--) {
            const candidate = this.passageWords[i];
            const d = this.levenshtein(spoken, candidate);
            if (d < bestDist) {
                bestDist = d;
                bestIndex = i;
                bestWord = candidate;
            }
        }

        if (bestIndex >= 0 && bestDist <= maxDist) {
            return { word: bestWord, index: bestIndex, distance: bestDist };
        }
        return null;
    }

    private levenshtein(a: string, b: string): number {
        const m = a.length;
        const n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;

        // Use single-row DP for efficiency
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        let curr = new Array<number>(n + 1);

        for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            }
            [prev, curr] = [curr, prev];
        }

        return prev[n];
    }

    // ──────────── Listeners ────────────

    /** Subscribe to word recognition events. Returns unsubscribe function. */
    onWord(callback: (word: RecognizedWord) => void): () => void {
        this.wordListeners.push(callback);
        return () => {
            this.wordListeners = this.wordListeners.filter(cb => cb !== callback);
        };
    }

    /** Subscribe to interim text updates. Returns unsubscribe function. */
    onInterim(callback: (text: string) => void): () => void {
        this.interimListeners.push(callback);
        return () => {
            this.interimListeners = this.interimListeners.filter(cb => cb !== callback);
        };
    }
}

export const speechRecognitionService = new SpeechRecognitionService();
