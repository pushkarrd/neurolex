/**
 * VoiceReadingEngine — Voice-first reading assistance.
 *
 * Workflow:
 *   1. User clicks "Start Reading" → mic starts, speech recognition begins
 *   2. Engine continuously listens and validates pronunciation in real-time
 *   3. Triggers adaptive help (TTS at 0.5x + font boost + syllable breakdown) when:
 *      a) User re-reads the same word 2+ times
 *      b) User mispronounces a word (including silent letters like "pneumonia")
 *      c) User is silent for >5 seconds (stuck)
 *   4. Help = slow TTS of the stuck word + increase its font size + show syllable breakdown
 */

import { speechRecognitionService } from './SpeechRecognitionService';
import type { RecognizedWord } from './SpeechRecognitionService';
import { webSpeechTTSService } from './WebSpeechTTSService';
import { pronunciationAnalyser } from './PronunciationAnalyser';
import type { PronunciationScore } from './PronunciationAnalyser';
import { microphoneService } from './MicrophoneService';

// ──────────── Types ────────────

export interface StuckWordEvent {
    wordIndex: number;
    word: string;
    lineIndex: number;
    reason: 'reread' | 'mispronounced' | 'silence';
    syllables: string[];
    phonetic: string;
    pronunciationScore?: PronunciationScore;
}

export interface WordProgressEvent {
    wordIndex: number;
    word: string;
    confidence: number;
}

export interface VoiceReadingState {
    isActive: boolean;
    currentWordIndex: number;
    stuckWord: StuckWordEvent | null;
    wordsRead: number;
    micActive: boolean;
}

type StuckCallback = (event: StuckWordEvent) => void;
type ProgressCallback = (event: WordProgressEvent) => void;
type StateCallback = (state: VoiceReadingState) => void;

// ──────────── Constants ────────────

/** Silence duration (ms) before triggering help */
const SILENCE_THRESHOLD_MS = 5_000;

/** How many times a word must be re-read to trigger help */
const REREAD_TRIGGER_COUNT = 2;

/** Cooldown per word to avoid spamming help (ms) */
const WORD_HELP_COOLDOWN_MS = 5_000;

/** Maximum times TTS help fires for a single word, then stops */
const MAX_HELP_PER_WORD = 2;

/** TTS speed for help pronunciation */
const HELP_TTS_RATE = 0.75;

/** Limit UI progress updates to avoid render thrash on long passages */
const PROGRESS_EMIT_THROTTLE_MS = 70;

/** Limit expensive pronunciation checks for interim tokens */
const PRONUNCIATION_CHECK_THROTTLE_MS = 120;

/** Font boost in px for the stuck word */
const STUCK_FONT_BOOST_PX = 6;

// ──────────── Common consonant blends ────────────

const COMMON_BLENDS = new Set([
    'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr',
    'ph', 'pl', 'pr', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp',
    'st', 'str', 'sw', 'th', 'tr', 'tw', 'wh', 'wr',
]);

// ──────────── Hard-word detection ────────────
// Only correct pronunciation for genuinely tricky words.
// Skip simple/common words — speech recognition noise causes false positives on them.

/** Very common short words that should never trigger pronunciation help */
const EASY_WORDS = new Set([
    'a', 'an', 'am', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
    'can', 'come', 'did', 'do', 'down', 'each', 'find', 'for', 'from',
    'get', 'go', 'got', 'had', 'has', 'have', 'he', 'her', 'here', 'him',
    'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
    'let', 'like', 'look', 'make', 'me', 'more', 'much', 'my', 'new',
    'no', 'not', 'now', 'of', 'off', 'on', 'one', 'only', 'or', 'our',
    'out', 'own', 'put', 'run', 'said', 'say', 'see', 'set', 'she', 'so',
    'some', 'such', 'take', 'tell', 'than', 'that', 'the', 'them', 'then',
    'there', 'these', 'they', 'this', 'time', 'to', 'too', 'two', 'up',
    'us', 'use', 'very', 'want', 'was', 'way', 'we', 'well', 'were',
    'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
    'word', 'work', 'would', 'yes', 'yet', 'you', 'your',
]);

/** Patterns that contain silent letters or tricky phonemes */
const SILENT_LETTER_PATTERNS = [
    /^kn/,       // knife, knight, know, knot, kneel
    /^wr/,       // write, wrong, wrist, wrap
    /^gn/,       // gnaw, gnat, gnome
    /^pn/,       // pneumonia, pneumatic
    /^ps/,       // psychology, pseudo, psalm
    /^pt/,       // pterodactyl
    /^mn/,       // mnemonic
    /mb$/,       // climb, lamb, bomb, thumb, dumb
    /mn$/,       // autumn, column, hymn
    /bt$/,       // doubt, debt, subtle
    /ght/,       // knight, thought, daughter, light
    /ough/,      // through, though, thought, cough, rough
    /tion$/,     // nation, station, pronunciation
    /sion$/,     // vision, decision, tension
    /eous$/,     // gorgeous, courageous
    /ious$/,     // precious, conscious
    /tious$/,    // cautious, ambitious
    /aque$/,     // opaque
    /que$/,      // technique, unique, antique
    /ph/,        // photograph, phone, pharmacy
    /sch/,       // school, schedule
    /tch/,       // watch, catch, match
    /dge/,       // bridge, knowledge, edge
    /igh/,       // sigh, high, night
    /eigh/,      // weigh, eight, neighbour
    /augh/,      // daughter, taught, caught
];

/**
 * Determine if a word is "hard" enough to warrant pronunciation help.
 * Returns true for words with silent letters, unusual phoneme combos,
 * or long/complex spelling. Returns false for simple common words.
 */
function isHardWord(word: string): boolean {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');

    // Never correct easy common words
    if (EASY_WORDS.has(w)) return false;

    // Very short words (<=3 letters) are almost never hard
    if (w.length <= 3) return false;

    // Check for silent letter / tricky phoneme patterns
    for (const pattern of SILENT_LETTER_PATTERNS) {
        if (pattern.test(w)) return true;
    }

    // Treat only clearly complex longer words as hard to avoid over-triggering.
    if (w.length >= 9) return true;

    // Words with unusual letter combinations (double vowels, uncommon clusters)
    if (/([aeiou]{3})|([^aeiou]{4})/.test(w)) return true;

    // Words with uncommon letters are often harder, but only if not short.
    if (w.length >= 6 && /[xzq]/.test(w)) return true;

    // 5-8 letter words: only if they have silent/tricky patterns (already checked above).
    // Otherwise, skip them to avoid helping easy/common words.
    return false;
}

// ──────────── Engine ────────────

class VoiceReadingEngine {
    private active = false;
    private passageWords: string[] = [];
    private rawPassageWords: string[] = []; // preserves original casing for display
    private wordsPerLine = 12;

    // Tracking
    private currentWordIndex = 0;
    private wordReadCounts = new Map<number, number>(); // wordIndex → how many times read
    private wordHelpCooldowns = new Map<number, number>(); // wordIndex → last help timestamp
    private wordHelpCounts = new Map<number, number>(); // wordIndex → how many times help was given
    private lastSpeechTime = 0;
    private silenceTimer: ReturnType<typeof setInterval> | null = null;

    // Current stuck word state (for UI)
    private currentStuckWord: StuckWordEvent | null = null;

    // Listeners
    private stuckListeners: StuckCallback[] = [];
    private progressListeners: ProgressCallback[] = [];
    private stateListeners: StateCallback[] = [];
    private cleanups: (() => void)[] = [];

    // Stats
    private wordsRead = 0;
    private lastProgressEmitAt = 0;
    private lastPronunciationCheckAt = 0;

    // ──────────── Public API ────────────

    async start(passageText: string, wordsPerLine = 12): Promise<void> {
        if (this.active) this.stop();

        this.active = true;
        this.wordsPerLine = wordsPerLine;

        // Parse passage
        this.rawPassageWords = passageText.split(/\s+/).filter(Boolean);
        this.passageWords = this.rawPassageWords.map(w =>
            w.toLowerCase().replace(/[^a-z']/g, ''),
        ).filter(Boolean);

        this.currentWordIndex = 0;
        this.wordReadCounts.clear();
        this.wordHelpCooldowns.clear();
        this.wordHelpCounts.clear();
        this.wordsRead = 0;
        this.currentStuckWord = null;
        this.lastProgressEmitAt = 0;
        this.lastPronunciationCheckAt = 0;

        // Initialise TTS (synchronous, instant)
        webSpeechTTSService.initialise();

        // Configure speech recognition with passage words
        speechRecognitionService.setPassageWords(this.passageWords);

        // Subscribe to word events
        const unsubWord = speechRecognitionService.onWord((recognized) => {
            this.handleRecognizedWord(recognized);
        });
        this.cleanups.push(unsubWord);

        // Start recognition IMMEDIATELY — no awaits, zero startup delay
        speechRecognitionService.start();

        // Silence detection timer (check every 1s)
        this.lastSpeechTime = Date.now();
        this.silenceTimer = setInterval(() => this.checkSilence(), 1000);
        this.cleanups.push(() => {
            if (this.silenceTimer) clearInterval(this.silenceTimer);
        });

        this.emitState();

        // Load phonemes and mic in background (non-blocking).
        // Pronunciation scoring falls back to estimatePhonemes() until
        // the CMU dictionary finishes loading (typically < 200ms).
        pronunciationAnalyser.loadPhonemes().catch(() => { });
        microphoneService.start().catch(() => {
            console.warn('[VoiceReadingEngine] Mic unavailable');
        });
    }

    stop(): void {
        this.active = false;

        // Run all cleanup functions
        this.cleanups.forEach(fn => fn());
        this.cleanups = [];

        speechRecognitionService.stop();
        microphoneService.stop();
        webSpeechTTSService.stop();

        if (this.silenceTimer) {
            clearInterval(this.silenceTimer);
            this.silenceTimer = null;
        }

        this.currentStuckWord = null;
        this.emitState();
    }

    /** Dismiss the current stuck word help (user can click to proceed) */
    dismissStuckWord(): void {
        this.currentStuckWord = null;
        this.emitState();
    }

    // ──────────── Subscriptions ────────────

    onStuckWord(cb: StuckCallback): () => void {
        this.stuckListeners.push(cb);
        return () => { this.stuckListeners = this.stuckListeners.filter(c => c !== cb); };
    }

    onWordProgress(cb: ProgressCallback): () => void {
        this.progressListeners.push(cb);
        return () => { this.progressListeners = this.progressListeners.filter(c => c !== cb); };
    }

    onStateChange(cb: StateCallback): () => void {
        this.stateListeners.push(cb);
        return () => { this.stateListeners = this.stateListeners.filter(c => c !== cb); };
    }

    getState(): VoiceReadingState {
        return {
            isActive: this.active,
            currentWordIndex: this.currentWordIndex,
            stuckWord: this.currentStuckWord,
            wordsRead: this.wordsRead,
            micActive: this.active,
        };
    }

    getCurrentWordIndex(): number {
        return this.currentWordIndex;
    }

    // ──────────── Core Logic ────────────

    private handleRecognizedWord(recognized: RecognizedWord): void {
        if (!this.active) return;

        this.lastSpeechTime = Date.now();

        // Clear silence-triggered stuck word when user starts speaking again
        if (this.currentStuckWord?.reason === 'silence') {
            this.currentStuckWord = null;
            this.emitState();
        }

        const matchedIndex = recognized.matchedIndex;

        // ── Unmatched word: the user spoke something the recogniser couldn't
        //    place in the passage — likely a severe mispronunciation of the
        //    current expected word. Only trigger help for hard words.
        if (matchedIndex === null || matchedIndex < 0) {
            if (this.currentWordIndex < this.passageWords.length) {
                const expected = this.passageWords[this.currentWordIndex];
                // Only run heavier scoring for final results or throttled interim updates.
                const now = Date.now();
                const canCheck = recognized.isFinal || (now - this.lastPronunciationCheckAt >= PRONUNCIATION_CHECK_THROTTLE_MS);
                if (isHardWord(expected) && canCheck) {
                    this.lastPronunciationCheckAt = now;
                    const score = pronunciationAnalyser.analyseWord(expected, recognized.word);
                    if (!score.isCorrect && score.score < 0.55) {
                        this.triggerHelp(this.currentWordIndex, 'mispronounced', score, now);
                    }
                }
            }
            return;
        }

        const targetWord = this.passageWords[matchedIndex];
        if (!targetWord) return;

        // Only advance the highlight cursor FORWARD (never backward) —
        // going backward is what caused the "jumps to previous line" bug.
        if (matchedIndex > this.currentWordIndex) {
            this.currentWordIndex = matchedIndex;
        }

        // Emit progress for interim + final, throttled to keep highlighting smooth.
        this.emitProgress(matchedIndex, targetWord, recognized.confidence, recognized.isFinal);

        // ===== Real-time pronunciation validation =====
        const now = Date.now();
        let score: PronunciationScore | undefined;

        // Avoid running pronunciation analysis on every interim token.
        const shouldCheckPronunciation = recognized.isFinal || (now - this.lastPronunciationCheckAt >= PRONUNCIATION_CHECK_THROTTLE_MS);
        if (shouldCheckPronunciation) {
            this.lastPronunciationCheckAt = now;
            score = pronunciationAnalyser.analyseWord(targetWord, recognized.word);
        }

        // Rule 2: Mispronunciation — only for hard words (silent letters, long/complex)
        // Simple common words are skipped to avoid false positives from speech recognition.
        if (score && !score.isCorrect && score.score < 0.50 && isHardWord(targetWord)) {
            this.triggerHelp(matchedIndex, 'mispronounced', score, now);
            // Still count the final result for re-read tracking below
            if (!recognized.isFinal) return;
        }

        // ===== Re-read counting uses only final results =====
        if (!recognized.isFinal) return;

        const prevCount = this.wordReadCounts.get(matchedIndex) || 0;
        this.wordReadCounts.set(matchedIndex, prevCount + 1);
        this.wordsRead++;

        // Rule 1: User re-reads the same word 2+ times — only for hard words
        if (prevCount + 1 >= REREAD_TRIGGER_COUNT && isHardWord(targetWord)) {
            this.triggerHelp(matchedIndex, 'reread', score, now);
            return;
        }

        // Rule 3 (silence) is handled by checkSilence() timer — not here

        this.emitState();
    }

    private checkSilence(): void {
        if (!this.active) return;

        const elapsed = Date.now() - this.lastSpeechTime;
        if (elapsed >= SILENCE_THRESHOLD_MS && !this.currentStuckWord) {
            // User has been silent — they're stuck on the current word
            // Only help on hard words; easy words don't need pronunciation aid
            const targetIndex = this.currentWordIndex;
            if (targetIndex < this.passageWords.length && isHardWord(this.passageWords[targetIndex])) {
                this.triggerHelp(targetIndex, 'silence', undefined, Date.now());
            }
        }
    }

    private triggerHelp(
        wordIndex: number,
        reason: 'reread' | 'mispronounced' | 'silence',
        score?: PronunciationScore,
        now = Date.now(),
    ): void {
        // Max-repeat guard: only help MAX_HELP_PER_WORD times per word, then stop
        const helpsSoFar = this.wordHelpCounts.get(wordIndex) || 0;
        if (helpsSoFar >= MAX_HELP_PER_WORD) return;

        // Cooldown check
        const lastHelp = this.wordHelpCooldowns.get(wordIndex);
        if (lastHelp && now - lastHelp < WORD_HELP_COOLDOWN_MS) return;
        this.wordHelpCooldowns.set(wordIndex, now);
        this.wordHelpCounts.set(wordIndex, helpsSoFar + 1);

        const word = this.rawPassageWords[wordIndex] || this.passageWords[wordIndex];
        const cleanWord = this.passageWords[wordIndex];
        const lineIndex = Math.floor(wordIndex / this.wordsPerLine);

        // Build syllable breakdown
        const syllables = this.breakIntoSyllables(cleanWord);

        // Get phonetic representation
        const phonetic = score?.phoneticTarget ||
            this.getPhonetic(cleanWord);

        const event: StuckWordEvent = {
            wordIndex,
            word,
            lineIndex,
            reason,
            syllables,
            phonetic,
            pronunciationScore: score,
        };

        this.currentStuckWord = event;

        // Emit to listeners
        for (const cb of this.stuckListeners) {
            cb(event);
        }

        // Auto TTS at 0.5x speed
        webSpeechTTSService.speakImmediate({
            text: word,
            rate: HELP_TTS_RATE,
            type: 'pronunciation-correction',
            targetWordIndex: wordIndex,
            targetLineIndex: lineIndex,
        });

        this.emitState();
    }

    private emitProgress(wordIndex: number, word: string, confidence: number, isFinal: boolean): void {
        const now = Date.now();
        const shouldEmit = isFinal || (now - this.lastProgressEmitAt >= PROGRESS_EMIT_THROTTLE_MS);
        if (!shouldEmit) return;
        this.lastProgressEmitAt = now;
        for (const cb of this.progressListeners) {
            cb({ wordIndex, word, confidence });
        }
    }

    // ──────────── Syllable Breakdown ────────────

    breakIntoSyllables(word: string): string[] {
        if (!word || word.length < 4) return [word];

        const lower = word.toLowerCase();
        const syllables: string[] = [];
        let current = '';
        const vowels = 'aeiouy';
        const isVowel = (c: string) => vowels.includes(c);

        for (let i = 0; i < word.length; i++) {
            current += word[i];

            if (i < word.length - 1) {
                const curIsVowel = isVowel(lower[i]);
                const nextIsVowel = isVowel(lower[i + 1]);

                // Split after a vowel followed by a consonant that starts a new syllable
                if (curIsVowel && !nextIsVowel && i + 2 < word.length && isVowel(lower[i + 2])) {
                    syllables.push(current);
                    current = '';
                }
                // Split between two consonants (if not a common blend)
                else if (!curIsVowel && !nextIsVowel && current.length > 1 && i + 1 < word.length - 1) {
                    const blend = lower[i] + lower[i + 1];
                    if (!COMMON_BLENDS.has(blend)) {
                        syllables.push(current);
                        current = '';
                    }
                }
                // Split between a consonant and vowel pair after enough chars
                else if (!curIsVowel && nextIsVowel && current.length > 2) {
                    const lastChar = current[current.length - 1];
                    syllables.push(current.slice(0, -1));
                    current = lastChar;
                }
            }
        }
        if (current) syllables.push(current);

        return syllables.length > 1 ? syllables : [word];
    }

    private getPhonetic(word: string): string {
        const phonemes = pronunciationAnalyser.phonemeDictionary.get(word) ||
            pronunciationAnalyser.estimatePhonemes(word);
        const ARPA_TO_READABLE: Record<string, string> = {
            AA: 'ah', AE: 'a', AH: 'uh', AO: 'aw', AW: 'ow',
            AY: 'i', B: 'b', CH: 'ch', D: 'd', DH: 'th',
            EH: 'e', ER: 'er', EY: 'ay', F: 'f', G: 'g',
            HH: 'h', IH: 'i', IY: 'ee', JH: 'j', K: 'k',
            L: 'l', M: 'm', N: 'n', NG: 'ng', OW: 'oh',
            OY: 'oy', P: 'p', R: 'r', S: 's', SH: 'sh',
            T: 't', TH: 'th', UH: 'oo', UW: 'oo', V: 'v',
            W: 'w', Y: 'y', Z: 'z', ZH: 'zh',
        };
        return phonemes.map(p => ARPA_TO_READABLE[p] || p.toLowerCase()).join('-');
    }

    private emitState(): void {
        const state = this.getState();
        for (const cb of this.stateListeners) {
            cb(state);
        }
    }
}

export const voiceReadingEngine = new VoiceReadingEngine();
