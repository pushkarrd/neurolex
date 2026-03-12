// Dyslexia-Friendly Reading Interface
// Students paste or upload text → rendered in accessible format
// Features: OpenDyslexic font, spacing controls, reading ruler, color overlays, TTS, Gaze Tracking

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    BookOpen, Upload, Play, Pause, ArrowLeft,
    Volume2, VolumeX, Type, Eye, FileText, Loader2, SplitSquareHorizontal, Crosshair, BarChart3, Zap, Mic
} from 'lucide-react';
import useDyslexiaStore from '../stores/dyslexiaStore';
import { useAuth } from '../context/AuthContext';
import { logReadingSession } from '../services/progressService';
// Gaze tracking
import { GazeProvider, useGaze } from '../context/GazeContext';
import CalibrationWizard from '../components/gaze/CalibrationWizard';
import GazeHighlighter from '../components/gaze/GazeHighlighter';
import GazeTTS from '../components/gaze/GazeTTS';
import GazeHeatmap from '../components/gaze/GazeHeatmap';
import GazePiP from '../components/gaze/GazePiP';
import WordHighlighter from '../components/gaze/WordHighlighter';
import ReadingAnalytics from '../components/gaze/ReadingAnalytics';
import useLineMapper, { splitIntoReadingLines } from '../hooks/useLineMapper';
import useRereadDetector from '../hooks/useRereadDetector';
import useAdaptiveTypography from '../hooks/useAdaptiveTypography';
import {
    startGazeSession, recordLineGaze, recordRereadEvent,
    recordAdaptiveLevel, endGazeSession, getCurrentSessionSnapshot,
    recordWordRead, recordWordStruggle, recordFusionStats,
} from '../services/gazeAnalytics';
// Lip sync + fusion
import LipSyncEngine from '../services/LipSyncEngine';
import FusionEngine from '../services/FusionEngine';
import { WordRegistryManager } from '../utils/WordRegistry';
// Trimodal reading intelligence
import { trimodalOrchestrator } from '../services/TrimodalOrchestrator';
import TrimodalStatusBar from '../components/gaze/TrimodalStatusBar';
import PronunciationFeedback from '../components/gaze/PronunciationFeedback';
import { PhoneticHintManager } from '../components/gaze/PhoneticHint';
import { pronunciationAnalyser } from '../services/PronunciationAnalyser';
// Voice-first reading engine
import { voiceReadingEngine } from '../services/VoiceReadingEngine';



// Wrapper that provides gaze context
export default function ReadingPage() {
    return (
        <GazeProvider>
            <ReadingPageInner />
        </GazeProvider>
    );
}

function ReadingPageInner() {
    const navigate = useNavigate();
    const { currentUser: user } = useAuth();
    const [text, setText] = useState('');
    const readingStartRef = React.useRef(null);
    const [isReading, setIsReading] = useState(false);
    const [displayMode, setDisplayMode] = useState('input'); // input | reading
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1);
    const [speechRate, setSpeechRate] = useState(1);
    const [isExtractingPDF, setIsExtractingPDF] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [syllableMode, setSyllableMode] = useState(false);
    const textDisplayRef = useRef(null);
    const utteranceRef = useRef(null);

    // ---- Gaze tracking state ----
    const { startGaze, stopGaze, gazeActive, isCalibrated, setCalibrated, faceLandmarksRef, faceMeshService } = useGaze();
    const [gazeEnabled, setGazeEnabled] = useState(false);
    const [showCalibration, setShowCalibration] = useState(false);
    const [showHeatmap, setShowHeatmap] = useState(false);
    const [heatmapSnapshot, setHeatmapSnapshot] = useState(null);

    // ---- Lip sync + Fusion state ----
    const lipSyncRef = useRef(null);
    const fusionRef = useRef(null);
    const registryRef = useRef(null);
    const fusionLoopRef = useRef(null);
    const [lipSyncActive, setLipSyncActive] = useState(false);
    const [fusionState, setFusionState] = useState(null);   // { confidence, method, text }
    const [struggleWords, setStruggleWords] = useState(new Set());
    const [rereadWordsMap, setRereadWordsMap] = useState(new Map());
    const [showAnalytics, setShowAnalytics] = useState(false);

    // ---- Trimodal state ----
    const [trimodalActive, setTrimodalActive] = useState(false);
    const [phoneticHints, setPhoneticHints] = useState([]);
    const [fontBoostPx, setFontBoostPx] = useState(0);

    // ---- Voice Reading Engine state ----
    const [voiceReadingActive, setVoiceReadingActive] = useState(false);
    const [stuckWord, setStuckWord] = useState(null); // { wordIndex, word, lineIndex, reason, syllables, phonetic }
    const [voiceCurrentWord, setVoiceCurrentWord] = useState(-1); // current word index from voice
    const [stuckWordSet, setStuckWordSet] = useState(new Set()); // all words that ever triggered help
    const pendingVoiceWordRef = useRef(-1);
    const voiceWordRafRef = useRef(null);

    // Gaze hooks (only active when gazeEnabled && displayMode === 'reading')
    const gazeReading = gazeEnabled && displayMode === 'reading';
    const { currentLine, rebuildRects } = useLineMapper(gazeReading ? textDisplayRef : { current: null });
    const { rereadLines, rereadLog, resetReread } = useRereadDetector(gazeReading ? currentLine : -1, gazeReading);
    const { getLineStyle, getLineLevel, resetTypography } = useAdaptiveTypography(rereadLines, gazeReading);

    // Record line gaze for analytics
    useEffect(() => {
        if (gazeReading && currentLine >= 0) {
            recordLineGaze(currentLine);
            const level = getLineLevel(currentLine);
            if (level > 0) recordAdaptiveLevel(currentLine, level);
        }
    }, [currentLine, gazeReading, getLineLevel]);

    // Record reread events for analytics
    useEffect(() => {
        if (!gazeReading) return;
        const handler = (e) => {
            const { lineIndex, count } = e.detail;
            recordRereadEvent(lineIndex, count);
        };
        window.addEventListener('reread', handler);
        return () => window.removeEventListener('reread', handler);
    }, [gazeReading]);

    // ---- Lip Sync + Fusion lifecycle ----
    useEffect(() => {
        if (!gazeReading) {
            // Teardown when gaze reading stops
            if (fusionLoopRef.current) cancelAnimationFrame(fusionLoopRef.current);
            if (lipSyncRef.current) { lipSyncRef.current.destroy(); lipSyncRef.current = null; }
            if (fusionRef.current) { fusionRef.current.destroy(); fusionRef.current = null; }
            if (registryRef.current) { registryRef.current.detach(); registryRef.current = null; }
            setLipSyncActive(false);
            setFusionState(null);
            return;
        }

        // Check hardware capability
        const cores = navigator.hardwareConcurrency || 2;
        const canLipSync = cores >= 4;

        // Initialize engines
        const lipEngine = new LipSyncEngine();
        const fusionEngine = new FusionEngine();
        lipSyncRef.current = lipEngine;
        fusionRef.current = fusionEngine;

        // Word change tracking for analytics
        const unsubWord = fusionEngine.onWordChange((detail) => {
            setFusionState({ confidence: detail.confidence, method: detail.method, text: detail.text });
            setRereadWordsMap(new Map(fusionEngine.rereadWords));
            recordWordRead(detail);
        });

        const unsubStruggle = fusionEngine.onWordStruggle((detail) => {
            setStruggleWords(new Set(fusionEngine.struggleWords));
            recordWordStruggle(detail);
        });

        // Attach word registry once textDisplayRef is ready
        let registryAttached = false;
        const attachRegistry = () => {
            if (!textDisplayRef.current || registryAttached) return;
            const reg = new WordRegistryManager();
            reg.attach(textDisplayRef.current);
            registryRef.current = reg;
            registryAttached = true;
        };

        // Delay slightly to let React render the text
        const regTimer = setTimeout(attachRegistry, 300);

        // FaceMeshService handles detection; feed lip engine from faceLandmarksRef
        // via a polling loop (landmarks arrive in context from FaceMeshService callback)
        if (canLipSync) setLipSyncActive(true);

        let lipRunning = true;
        let lastLipLandmarks = null;
        const lipPoll = () => {
            if (!lipRunning) return;
            const lm = faceLandmarksRef.current;
            if (lm && lm !== lastLipLandmarks && canLipSync && lipSyncRef.current) {
                lastLipLandmarks = lm;
                lipEngine.processFrame(lm);
            }
            requestAnimationFrame(lipPoll);
        };
        requestAnimationFrame(lipPoll);

        // Fusion tick loop (~30fps): combine gaze + lip into word decision
        const gazeRef = { x: 0, y: 0 };
        const gazeHandler = (e) => {
            gazeRef.x = e.detail.x;
            gazeRef.y = e.detail.y;
        };
        window.addEventListener('gazeupdate', gazeHandler);

        let running = true;
        let cachedLipResult = null;
        let lipMatchPending = false;
        const fusionTick = () => {
            if (!running) return;
            if (registryRef.current && fusionRef.current) {
                // Get lip match result if available
                let lipResult = cachedLipResult;
                if (lipSyncRef.current && registryRef.current && !lipMatchPending) {
                    const candidates = registryRef.current.getWordCandidates(gazeRef.x, gazeRef.y);
                    if (candidates.length > 0) {
                        lipMatchPending = true;
                        const matchPromise = lipSyncRef.current.matchWord(candidates.map(c => c.text));
                        if (matchPromise && matchPromise.then) {
                            matchPromise.then((match) => {
                                lipMatchPending = false;
                                if (match && match.word) {
                                    const matched = candidates.find(c => c.text === match.word);
                                    if (matched) {
                                        cachedLipResult = {
                                            wordIndex: matched.wordIndex,
                                            text: matched.text,
                                            confidence: match.confidence || 0.5,
                                        };
                                    }
                                } else {
                                    cachedLipResult = null;
                                }
                            }).catch(() => { lipMatchPending = false; });
                        } else if (matchPromise) {
                            lipMatchPending = false;
                            const matched = candidates.find(c => c.text === matchPromise.word);
                            if (matched) {
                                cachedLipResult = {
                                    wordIndex: matched.wordIndex,
                                    text: matched.text,
                                    confidence: matchPromise.confidence || 0.5,
                                };
                                lipResult = cachedLipResult;
                            }
                        } else {
                            lipMatchPending = false;
                        }
                    }
                }

                fusionRef.current.processTick(
                    gazeRef.x,
                    gazeRef.y,
                    lipResult,
                    registryRef.current
                );
            }
            fusionLoopRef.current = requestAnimationFrame(fusionTick);
        };
        fusionLoopRef.current = requestAnimationFrame(fusionTick);

        return () => {
            running = false;
            lipRunning = false;
            clearTimeout(regTimer);
            if (fusionLoopRef.current) cancelAnimationFrame(fusionLoopRef.current);
            window.removeEventListener('gazeupdate', gazeHandler);
            unsubWord();
            unsubStruggle();
            if (lipSyncRef.current) { lipSyncRef.current.destroy(); lipSyncRef.current = null; }
            if (fusionRef.current) {
                recordFusionStats(fusionRef.current.getReadingStats());
                fusionRef.current.destroy();
                fusionRef.current = null;
            }
            if (registryRef.current) { registryRef.current.detach(); registryRef.current = null; }
            setLipSyncActive(false);
        };
    }, [gazeReading, faceLandmarksRef]);

    // ---- Trimodal Orchestrator lifecycle ----
    useEffect(() => {
        if (!gazeReading || !textDisplayRef.current || !text.trim()) {
            if (trimodalActive) {
                trimodalOrchestrator.stop();
                setTrimodalActive(false);
                setPhoneticHints([]);
                setFontBoostPx(0);
            }
            return;
        }

        // Small delay to let word spans render
        const startTimer = setTimeout(async () => {
            try {
                await trimodalOrchestrator.start(text, textDisplayRef.current, faceLandmarksRef);
                setTrimodalActive(true);

                // Listen for adaptive actions (phonetic hints, font boosts)
                const unsubAction = trimodalOrchestrator.onAction((action) => {
                    if (action.type === 'phonetic_hint') {
                        // Get word rect from registry
                        const reg = trimodalOrchestrator.getRegistry();
                        const entry = reg?.getWordByIndex(action.wordIndex);
                        setPhoneticHints(prev => [...prev, {
                            wordIndex: action.wordIndex,
                            text: action.text,
                            phoneticText: action.hintText || '',
                            rect: entry?.rect || null,
                            durationMs: action.hintDurationMs || 4000,
                        }]);
                    }
                    if (action.type === 'font_boost') {
                        setFontBoostPx(action.fontBoostPx || 0);
                    }
                });

                // Listen for word changes to update existing fusion state display
                const unsubWord = trimodalOrchestrator.onWordChange((detail) => {
                    setFusionState({ confidence: detail.confidence, method: detail.method, text: detail.text });
                    setRereadWordsMap(new Map(trimodalOrchestrator.getFusionEngine().getRereadWords()));
                });

                const unsubStruggle = trimodalOrchestrator.onWordStruggle((detail) => {
                    setStruggleWords(new Set(trimodalOrchestrator.getFusionEngine().getStruggleWords()));
                    recordWordStruggle(detail);
                });

                // Store cleanup refs for the subscriptions
                return () => {
                    unsubAction();
                    unsubWord();
                    unsubStruggle();
                };
            } catch (e) {
                console.warn('[ReadingPage] Trimodal start failed:', e);
            }
        }, 500);

        return () => {
            clearTimeout(startTimer);
            trimodalOrchestrator.stop();
            setTrimodalActive(false);
        };
    }, [gazeReading, text, faceLandmarksRef]);

    // ---- Voice Reading Engine lifecycle ----
    // Starts when user enters reading mode (regardless of gaze), always-on mic
    useEffect(() => {
        if (displayMode !== 'reading' || !text.trim()) {
            if (voiceReadingActive) {
                voiceReadingEngine.stop();
                setVoiceReadingActive(false);
                setStuckWord(null);
                setVoiceCurrentWord(-1);
            }
            return;
        }

        // Start the voice engine after a brief render delay
        const timer = setTimeout(async () => {
            try {
                await voiceReadingEngine.start(text, 12);
                setVoiceReadingActive(true);

                // Listen for stuck words (reread, mispronounced, silence)
                const unsubStuck = voiceReadingEngine.onStuckWord((event) => {
                    setStuckWord(event);
                    setStuckWordSet(prev => new Set([...prev, event.wordIndex]));
                });

                // Listen for word progress (to track current reading position)
                const unsubProgress = voiceReadingEngine.onWordProgress((event) => {
                    pendingVoiceWordRef.current = event.wordIndex;
                    if (!voiceWordRafRef.current) {
                        voiceWordRafRef.current = requestAnimationFrame(() => {
                            setVoiceCurrentWord(pendingVoiceWordRef.current);
                            voiceWordRafRef.current = null;
                        });
                    }
                    // Clear stuck word when user progresses past it
                    setStuckWord(prev => {
                        if (prev && event.wordIndex > prev.wordIndex) return null;
                        return prev;
                    });
                });

                // Store cleanups in a ref-safe way
                const cleanup = () => {
                    unsubStuck();
                    unsubProgress();
                };
                return cleanup;
            } catch (e) {
                console.warn('[ReadingPage] Voice engine start failed:', e);
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            if (voiceWordRafRef.current) {
                cancelAnimationFrame(voiceWordRafRef.current);
                voiceWordRafRef.current = null;
            }
            voiceReadingEngine.stop();
            setVoiceReadingActive(false);
            setStuckWord(null);
            setVoiceCurrentWord(-1);
        };
    }, [displayMode, text]);

    // Toggle gaze tracking
    const handleToggleGaze = useCallback(async () => {
        if (gazeEnabled) {
            // Stop gaze
            stopGaze();
            setGazeEnabled(false);
            // End analytics session & get snapshot
            const snap = getCurrentSessionSnapshot();
            setHeatmapSnapshot(snap);
            await endGazeSession();
        } else {
            // Start gaze
            const ok = await startGaze();
            if (ok) {
                setGazeEnabled(true);
                if (!isCalibrated) {
                    setShowCalibration(true);
                }
            }
        }
    }, [gazeEnabled, startGaze, stopGaze, isCalibrated]);

    const { dyslexicFont, fontSize, letterSpacing, wordSpacing, lineHeight, focusMode } = useDyslexiaStore();

    const speedOptions = [0.5, 0.8, 1, 1.2, 1.5, 2];

    const sampleTexts = [
        {
            title: "Photosynthesis",
            text: "Photosynthesis is the process by which green plants and some other organisms use sunlight to synthesize foods from carbon dioxide and water. Photosynthesis in plants generally involves the green pigment chlorophyll and generates oxygen as a byproduct. The process takes place primarily in the leaves of plants. Light energy is absorbed by chlorophyll, a green pigment contained in structures called chloroplasts."
        },
        {
            title: "The Water Cycle",
            text: "The water cycle describes how water evaporates from the surface of the earth, rises into the atmosphere, cools and condenses into rain or snow in clouds, and falls again to the surface as precipitation. The water falling on land collects in rivers and lakes, soil, and porous layers of rock, and much of it flows back into the oceans, where it will once more evaporate. The cycling of water in and out of the atmosphere is a significant aspect of the weather patterns on Earth."
        },
        {
            title: "Simple Machines",
            text: "A simple machine is a device that changes the direction or magnitude of a force. The six classical simple machines are the lever, wheel and axle, pulley, inclined plane, wedge, and screw. Simple machines are the basis for all mechanical systems. They make work easier by allowing us to push or pull over increased distances or with less force."
        },
    ];

    const handleStartReading = () => {
        if (text.trim()) {
            setDisplayMode('reading');
            setIsReading(true);
            readingStartRef.current = Date.now();
            // Start gaze analytics session
            const lines = splitIntoReadingLines(text);
            if (gazeEnabled) {
                startGazeSession('reading', lines.length);
            }
        }
    };

    const handleStopReading = () => {
        // Log reading session to Firebase
        if (user?.uid && readingStartRef.current) {
            const elapsed = Math.round((Date.now() - readingStartRef.current) / 1000);
            logReadingSession(user.uid, {
                textLength: text.length,
                readingTime: elapsed,
            });
            readingStartRef.current = null;
        }
        setDisplayMode('input');
        setIsSpeaking(false);
        window.speechSynthesis.cancel();
        // Stop voice reading engine
        if (voiceReadingActive) {
            voiceReadingEngine.stop();
            setVoiceReadingActive(false);
            setStuckWord(null);
            setVoiceCurrentWord(-1);
            setStuckWordSet(new Set());
        }
        // Record trimodal stats before stopping
        if (trimodalActive) {
            recordFusionStats(trimodalOrchestrator.getReadingStats());
            trimodalOrchestrator.stop();
            setTrimodalActive(false);
            setPhoneticHints([]);
            setFontBoostPx(0);
        }
        // Record fusion stats before ending session
        if (fusionRef.current) {
            recordFusionStats(fusionRef.current.getReadingStats());
        }
        // End gaze session & snapshot
        if (gazeEnabled) {
            const snap = getCurrentSessionSnapshot();
            setHeatmapSnapshot(snap);
            endGazeSession();
            resetReread();
            resetTypography();
        }
        setShowAnalytics(false);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploadError('');

        if (file.type === 'application/pdf') {
            setIsExtractingPDF(true);
            try {
                const pdfjsLib = await import('pdfjs-dist');
                pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    // Reconstruct text preserving line structure
                    const items = content.items;
                    let lastY = null;
                    let lineText = '';
                    for (const item of items) {
                        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
                            fullText += lineText.trim() + '\n';
                            lineText = '';
                        }
                        lineText += item.str + ' ';
                        lastY = item.transform[5];
                    }
                    if (lineText.trim()) fullText += lineText.trim() + '\n';
                    fullText += '\n';
                }

                const extracted = fullText.trim();
                if (!extracted) {
                    setUploadError('Could not extract text from this PDF. It may be scanned/image-based.');
                } else {
                    setText(extracted);
                }
            } catch (err) {
                console.error('PDF extraction error:', err);
                setUploadError('Failed to read PDF. Please try a different file or paste text manually.');
            } finally {
                setIsExtractingPDF(false);
            }
        } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                setText(ev.target.result);
            };
            reader.onerror = () => {
                setUploadError('Failed to read the text file.');
            };
            reader.readAsText(file);
        } else {
            setUploadError('Unsupported file type. Please upload a .pdf or .txt file.');
        }
        // Reset the input so re-uploading the same file triggers onChange
        e.target.value = '';
    };

    const handleSpeak = () => {
        if (isSpeaking) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            setHighlightedWordIndex(-1);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = speechRate;
        utterance.pitch = 1.0;

        const words = text.split(/\s+/);
        let wordIndex = 0;

        utterance.onboundary = (event) => {
            if (event.name === 'word') {
                setHighlightedWordIndex(wordIndex);
                wordIndex++;
            }
        };

        utterance.onend = () => {
            setIsSpeaking(false);
            setHighlightedWordIndex(-1);
        };

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
    };

    const words = text.split(/\s+/).filter(w => w.length > 0);

    // Syllable breakdown: only for hard/long words (6+ letters)
    const breakIntoSyllables = (word) => {
        // Strip punctuation for analysis, keep for display
        const punctMatch = word.match(/^([^a-zA-Z]*)(.*?)([^a-zA-Z]*)$/);
        if (!punctMatch) return word;
        const [, leadPunct, core, trailPunct] = punctMatch;
        if (core.length < 6) return word; // Only break long words

        const lower = core.toLowerCase();
        const syllables = [];
        let current = '';
        const vowels = 'aeiouy';
        const isVowel = (c) => vowels.includes(c);

        for (let i = 0; i < core.length; i++) {
            current += core[i];

            if (i < core.length - 1) {
                const curIsVowel = isVowel(lower[i]);
                const nextIsVowel = isVowel(lower[i + 1]);

                // Split after a vowel followed by a consonant that starts a new syllable
                if (curIsVowel && !nextIsVowel && i + 2 < core.length && isVowel(lower[i + 2])) {
                    syllables.push(current);
                    current = '';
                }
                // Split between two consonants (if not a common blend)
                else if (!curIsVowel && !nextIsVowel && current.length > 1 && i + 1 < core.length - 1) {
                    const blend = lower[i] + lower[i + 1];
                    const commonBlends = ['bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'ph', 'pl', 'pr', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'str', 'sw', 'th', 'tr', 'tw', 'wh', 'wr'];
                    if (!commonBlends.includes(blend)) {
                        syllables.push(current);
                        current = '';
                    }
                }
                // Split between a consonant and vowel pair after enough chars
                else if (!curIsVowel && nextIsVowel && current.length > 2) {
                    // Move last consonant to next syllable
                    const lastChar = current[current.length - 1];
                    syllables.push(current.slice(0, -1));
                    current = lastChar;
                }
            }
        }
        if (current) syllables.push(current);

        // Only return syllable breakdown if we got multiple syllables
        if (syllables.length <= 1) return word;
        return leadPunct + syllables.join('·') + trailPunct;
    };

    const renderWord = (word, i) => {
        const isHighlighted = highlightedWordIndex === i;
        const isVoiceCurrent = voiceCurrentWord === i;
        const isStuck = stuckWord && stuckWord.wordIndex === i;
        const wasStuck = stuckWordSet.has(i);

        // When this word is the stuck word, show syllable breakdown + font boost
        if (isStuck) {
            const syllables = stuckWord.syllables || [word];
            return (
                <span
                    key={i}
                    data-word-index={i}
                    className="inline-block transition-all duration-300 bg-red-500/20 text-white rounded-lg px-2 py-1 border border-red-400/40"
                    style={{
                        fontSize: `${fontSize + 6}px`,
                        lineHeight: 1.4,
                    }}
                >
                    {syllables.length > 1 ? (
                        syllables.map((syl, si) => (
                            <span key={si}>
                                <span className="text-yellow-300 font-bold">{syl}</span>
                                {si < syllables.length - 1 && (
                                    <span className="text-red-400 font-bold mx-[2px] text-[0.7em]">·</span>
                                )}
                            </span>
                        ))
                    ) : (
                        <span className="text-yellow-300 font-bold">{word}</span>
                    )}
                    {/* Phonetic hint below the word */}
                    {stuckWord.phonetic && (
                        <span className="block text-xs text-indigo-300/80 mt-1 font-mono">
                            /{stuckWord.phonetic}/
                        </span>
                    )}
                    {' '}
                </span>
            );
        }

        if (syllableMode && word.replace(/[^a-zA-Z]/g, '').length >= 6) {
            const broken = breakIntoSyllables(word);
            const parts = broken.split('·');
            if (parts.length > 1) {
                return (
                    <span
                        key={i}
                        data-word-index={i}
                        className={`inline transition-colors duration-150 ${isHighlighted || isVoiceCurrent ? 'bg-indigo-500/30 text-white rounded px-1 focus-active' : wasStuck ? 'text-orange-300' : 'text-white/90'
                            }`}
                    >
                        {parts.map((part, pi) => (
                            <span key={pi}>
                                {part}
                                {pi < parts.length - 1 && (
                                    <span className="text-indigo-400 font-bold mx-[1px] text-[0.7em]">·</span>
                                )}
                            </span>
                        ))}
                        {' '}
                    </span>
                );
            }
        }
        return (
            <span
                key={i}
                data-word-index={i}
                className={`inline transition-colors duration-150 ${isHighlighted || isVoiceCurrent ? 'bg-indigo-500/30 text-white rounded px-1 focus-active' : wasStuck ? 'text-orange-300' : 'text-white/90'
                    }`}
            >
                {word}{' '}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#0a0a1a] via-[#0f0f2e] to-[#1a0a2e] text-white">
            {/* Header */}
            <div className="sticky top-0 z-50 backdrop-blur-xl bg-black/30 border-b border-white/10">
                <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
                    >
                        <ArrowLeft size={20} />
                        <span>Dashboard</span>
                    </button>
                    <div className="flex items-center gap-2">
                        <BookOpen size={24} className="text-indigo-400" />
                        <h1 className="text-xl font-bold">Reading Assistant</h1>
                    </div>
                    <div className="w-24" />
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 py-8">
                {displayMode === 'input' ? (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6"
                    >
                        {/* Info banner */}
                        <div className="rounded-2xl p-6 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20">
                            <div className="flex items-start gap-3">
                                <Eye size={24} className="text-indigo-400 mt-1 shrink-0" />
                                <div>
                                    <h2 className="text-lg font-semibold mb-1">Dyslexia-Friendly Reading</h2>
                                    <p className="text-white/60 text-sm">
                                        Paste or upload any text to read it with OpenDyslexic font, adjustable spacing,
                                        color overlays, reading ruler, and text-to-speech. Use the accessibility toolbar
                                        (bottom-right) to customize your experience.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Text input */}
                        <div>
                            <label className="block text-sm text-white/60 mb-2">Paste your text here</label>
                            <textarea
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                rows={8}
                                placeholder="Paste or type the text you want to read..."
                                className="w-full rounded-xl p-4 bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-indigo-500 focus:outline-none resize-none"
                                style={{ fontSize: '16px', lineHeight: '1.6' }}
                            />
                        </div>

                        {/* File upload */}
                        <div className="flex items-center gap-4 flex-wrap">
                            <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer transition-colors">
                                <Upload size={18} />
                                <span className="text-sm">Upload .txt file</span>
                                <input
                                    type="file"
                                    accept=".txt"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>
                            <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 cursor-pointer transition-colors">
                                <FileText size={18} className="text-indigo-400" />
                                <span className="text-sm">Upload PDF</span>
                                <input
                                    type="file"
                                    accept=".pdf"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>
                            {isExtractingPDF && (
                                <div className="flex items-center gap-2 text-indigo-400 text-sm">
                                    <Loader2 size={16} className="animate-spin" />
                                    Extracting text from PDF...
                                </div>
                            )}
                            <span className="text-white/40 text-sm">or pick a sample →</span>
                        </div>
                        {uploadError && (
                            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
                                {uploadError}
                            </div>
                        )}

                        {/* Sample texts */}
                        <div>
                            <h3 className="text-sm text-white/60 mb-3">Sample Texts</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {sampleTexts.map((sample, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setText(sample.text)}
                                        className="text-left p-4 rounded-xl bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-white/10 transition-all"
                                    >
                                        <div className="font-medium text-sm mb-1">{sample.title}</div>
                                        <div className="text-xs text-white/40 line-clamp-2">{sample.text.substring(0, 80)}...</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Start reading */}
                        <motion.button
                            onClick={handleStartReading}
                            disabled={!text.trim()}
                            className="w-full py-4 rounded-xl font-semibold text-lg transition-all disabled:opacity-30"
                            style={{
                                background: text.trim() ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#333',
                            }}
                            whileHover={text.trim() ? { scale: 1.02 } : {}}
                            whileTap={text.trim() ? { scale: 0.98 } : {}}
                        >
                            <div className="flex items-center justify-center gap-2">
                                <BookOpen size={20} />
                                Start Reading
                            </div>
                        </motion.button>
                    </motion.div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-6"
                    >
                        {/* Controls bar */}
                        <div className="flex items-center justify-between rounded-xl p-4 bg-white/5 border border-white/10">
                            <button
                                onClick={handleStopReading}
                                className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
                            >
                                <ArrowLeft size={16} />
                                Back to input
                            </button>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleSpeak}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
                                    style={{
                                        background: isSpeaking ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                                        border: `1px solid ${isSpeaking ? 'rgba(239, 68, 68, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`,
                                    }}
                                >
                                    {isSpeaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                    <span className="text-sm">{isSpeaking ? 'Stop' : 'Read Aloud'}</span>
                                </button>

                                {/* Speed control */}
                                <div className="flex items-center gap-1">
                                    {speedOptions.map((speed) => (
                                        <button
                                            key={speed}
                                            onClick={() => {
                                                setSpeechRate(speed);
                                                // If currently speaking, restart with new speed
                                                if (isSpeaking) {
                                                    window.speechSynthesis.cancel();
                                                    setIsSpeaking(false);
                                                    setHighlightedWordIndex(-1);
                                                    setTimeout(() => {
                                                        const utterance = new SpeechSynthesisUtterance(text);
                                                        utterance.rate = speed;
                                                        utterance.pitch = 1.0;
                                                        const w = text.split(/\s+/);
                                                        let wi = 0;
                                                        utterance.onboundary = (ev) => { if (ev.name === 'word') { setHighlightedWordIndex(wi); wi++; } };
                                                        utterance.onend = () => { setIsSpeaking(false); setHighlightedWordIndex(-1); };
                                                        utteranceRef.current = utterance;
                                                        window.speechSynthesis.speak(utterance);
                                                        setIsSpeaking(true);
                                                    }, 50);
                                                }
                                            }}
                                            className="px-2 py-1 rounded text-xs font-medium transition-all"
                                            style={{
                                                background: speechRate === speed ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255,255,255,0.05)',
                                                border: speechRate === speed ? '1px solid rgba(99, 102, 241, 0.6)' : '1px solid rgba(255,255,255,0.1)',
                                                color: speechRate === speed ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                                                minWidth: '36px',
                                                minHeight: '32px',
                                            }}
                                        >
                                            {speed}x
                                        </button>
                                    ))}
                                </div>

                                {/* Syllable breakdown toggle */}
                                <button
                                    onClick={() => setSyllableMode(!syllableMode)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm"
                                    style={{
                                        background: syllableMode ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${syllableMode ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                                        color: syllableMode ? '#c084fc' : 'rgba(255,255,255,0.5)',
                                        minHeight: '32px',
                                    }}
                                    title="Break hard words into syllables"
                                >
                                    <SplitSquareHorizontal size={16} />
                                    <span className="text-xs">{syllableMode ? 'Syllables ON' : 'Break Down'}</span>
                                </button>

                                {/* Gaze tracking toggle */}
                                <button
                                    onClick={handleToggleGaze}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm"
                                    style={{
                                        background: gazeEnabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${gazeEnabled ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                                        color: gazeEnabled ? '#86efac' : 'rgba(255,255,255,0.5)',
                                        minHeight: '32px',
                                    }}
                                    title="Eye tracking — highlights where you're reading"
                                >
                                    <Crosshair size={16} />
                                    <span className="text-xs">{gazeEnabled ? 'Gaze ON' : 'Eye Track'}</span>
                                </button>

                                {/* Heatmap toggle (only if we have data) */}
                                {gazeEnabled && (
                                    <button
                                        onClick={() => {
                                            setHeatmapSnapshot(getCurrentSessionSnapshot());
                                            setShowHeatmap(!showHeatmap);
                                        }}
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm"
                                        style={{
                                            background: showHeatmap ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${showHeatmap ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                            color: showHeatmap ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                                            minHeight: '32px',
                                        }}
                                    >
                                        <BarChart3 size={16} />
                                        <span className="text-xs">Heatmap</span>
                                    </button>
                                )}

                                {/* Analytics toggle */}
                                {gazeEnabled && (
                                    <button
                                        onClick={() => {
                                            setHeatmapSnapshot(getCurrentSessionSnapshot());
                                            setShowAnalytics(!showAnalytics);
                                        }}
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm"
                                        style={{
                                            background: showAnalytics ? 'rgba(6,182,212,0.2)' : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${showAnalytics ? 'rgba(6,182,212,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                            color: showAnalytics ? '#67e8f9' : 'rgba(255,255,255,0.5)',
                                            minHeight: '32px',
                                        }}
                                    >
                                        <Zap size={16} />
                                        <span className="text-xs">Analytics</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Calibration Wizard */}
                        {showCalibration && (
                            <CalibrationWizard
                                onComplete={() => setShowCalibration(false)}
                                onSkip={() => setShowCalibration(false)}
                            />
                        )}

                        {/* Camera preview PiP (upgraded with lip overlay) + Gaze cursor dot */}
                        <GazePiP
                            enabled={gazeEnabled}
                            fusionState={fusionState}
                            lipSyncActive={lipSyncActive}
                            faceLandmarksRef={faceLandmarksRef}
                        />

                        {/* Trimodal Status Bar */}
                        {trimodalActive && <TrimodalStatusBar visible={trimodalActive} />}

                        {/* Voice Reading Status */}
                        {voiceReadingActive && (
                            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
                                <div className="relative flex items-center justify-center">
                                    <Mic size={16} className="text-green-400" />
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                </div>
                                <span className="text-sm text-green-300">
                                    Listening — read aloud and I'll help if you get stuck
                                </span>
                                <span className="ml-auto text-xs text-white/40">
                                    {voiceReadingEngine.getState().wordsRead} words read
                                </span>
                            </div>
                        )}

                        {/* Stuck Word Help Banner */}
                        {stuckWord && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                className="rounded-xl p-4 bg-gradient-to-r from-red-500/15 to-orange-500/15 border border-red-400/30"
                            >
                                <div className="flex items-start gap-3">
                                    <Volume2 size={20} className="text-yellow-400 mt-1 shrink-0 animate-pulse" />
                                    <div className="flex-1">
                                        <div className="text-sm text-white/60 mb-1">
                                            {stuckWord.reason === 'silence' && "Looks like you paused — here's help with this word:"}
                                            {stuckWord.reason === 'reread' && "You've read this word multiple times — let me help:"}
                                            {stuckWord.reason === 'mispronounced' && "Let me help you pronounce this hard word. Any doubts?"}
                                        </div>
                                        <div className="flex items-baseline gap-4 flex-wrap">
                                            <span className="text-2xl font-bold text-yellow-300">
                                                {stuckWord.syllables.length > 1
                                                    ? stuckWord.syllables.join(' · ')
                                                    : stuckWord.word
                                                }
                                            </span>
                                            {stuckWord.phonetic && (
                                                <span className="text-sm font-mono text-indigo-300/80">
                                                    /{stuckWord.phonetic}/
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            voiceReadingEngine.dismissStuckWord();
                                            setStuckWord(null);
                                        }}
                                        className="text-xs text-white/40 hover:text-white/70 px-2 py-1 rounded bg-white/5"
                                    >
                                        Got it
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* Reading area with gaze tracking */}
                        <div className="relative">
                            <GazeHighlighter
                                containerRef={textDisplayRef}
                                currentLine={currentLine}
                                enabled={gazeReading}
                            />
                            <WordHighlighter
                                containerRef={textDisplayRef}
                                enabled={gazeReading}
                                struggleWords={struggleWords}
                                rereadWords={rereadWordsMap}
                            />
                            {/* GazeTTS disabled — VoiceReadingEngine handles pronunciation help */}
                            <div
                                ref={textDisplayRef}
                                className="reading-content p-8 rounded-2xl bg-white/5 border border-white/10"
                                style={{
                                    fontFamily: dyslexicFont ? "'OpenDyslexic', sans-serif" : 'inherit',
                                    fontSize: `${fontSize + fontBoostPx}px`,
                                    letterSpacing: `${letterSpacing}px`,
                                    wordSpacing: `${wordSpacing}px`,
                                    lineHeight: lineHeight,
                                    maxWidth: '100%',
                                    position: 'relative',
                                    transition: 'font-size 0.4s ease-out',
                                }}
                            >
                                {gazeEnabled
                                    ? splitIntoReadingLines(text).map((lineProps) => {
                                        // Render individual words within each gaze line for voice tracking
                                        const lineIdx = lineProps['data-line-index'];
                                        const lineWords = lineProps.children.split(/\s+/).filter(Boolean);
                                        const startWordIdx = lineIdx * 12; // wordsPerLine = 12
                                        return (
                                            <div
                                                key={lineProps.key}
                                                data-line-index={lineIdx}
                                                className="py-1"
                                                style={getLineStyle(lineIdx, fontSize)}
                                            >
                                                {lineWords.map((w, wi) => renderWord(w, startWordIdx + wi))}
                                            </div>
                                        );
                                    })
                                    : words.map((word, i) => renderWord(word, i))
                                }
                            </div>

                            {/* Phonetic Hints overlay */}
                            {trimodalActive && (
                                <PhoneticHintManager
                                    hints={phoneticHints}
                                    onHintDismissed={(wordIndex) => {
                                        setPhoneticHints(prev => prev.filter(h => h.wordIndex !== wordIndex));
                                    }}
                                />
                            )}
                        </div>

                        {/* Pronunciation Feedback toasts */}
                        {trimodalActive && <PronunciationFeedback visible={trimodalActive} />}

                        {/* Gaze Heatmap */}
                        {showHeatmap && heatmapSnapshot && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="rounded-2xl p-6 bg-white/5 border border-white/10"
                            >
                                <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
                                    <BarChart3 size={16} className="text-indigo-400" />
                                    Reading Heatmap
                                </h3>
                                <GazeHeatmap
                                    heatmapData={heatmapSnapshot.heatmap || []}
                                    rereadLines={rereadLines}
                                    totalLines={heatmapSnapshot.totalLines || 0}
                                />
                            </motion.div>
                        )}

                        {/* Reading Analytics (word-level fusion data) */}
                        <ReadingAnalytics
                            visible={showAnalytics && gazeEnabled}
                            snapshot={heatmapSnapshot}
                        />

                        {/* Stats */}
                        <div className="flex items-center gap-6 text-sm text-white/40">
                            <span>{words.length} words</span>
                            <span>~{Math.ceil(words.length / 200)} min read</span>
                            <span>{text.split(/[.!?]+/).length - 1} sentences</span>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
