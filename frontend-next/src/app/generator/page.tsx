"use client";

// Multi-Modal Learning Content Generator
// Input: text or PDF → Output: NeuroLex notes, flashcards, quiz, mind map, audio

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
    Wand2, ArrowLeft, FileText, Upload, Loader2,
    BookOpen, Layers, Brain, HelpCircle, Volume2,
    ChevronLeft, ChevronRight, Check, X, RefreshCw, SplitSquareHorizontal,
    Crosshair, BarChart3, Zap
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { logContentGeneration, logQuizAttempt } from '@/services/progressService';
// Gaze tracking
import { GazeProvider, useGaze } from '@/context/GazeContext';
import CalibrationWizard from '@/components/gaze/CalibrationWizard';
import GazeHighlighter from '@/components/gaze/GazeHighlighter';
import GazeTTS from '@/components/gaze/GazeTTS';
import GazeHeatmap from '@/components/gaze/GazeHeatmap';
import GazePiP from '@/components/gaze/GazePiP';
import GazeDot from '@/components/gaze/GazeDot';
import WordHighlighter from '@/components/gaze/WordHighlighter';
import ReadingAnalytics from '@/components/gaze/ReadingAnalytics';
import useLineMapper, { splitIntoReadingLines } from '@/hooks/useLineMapper';
import useRereadDetector from '@/hooks/useRereadDetector';
import useAdaptiveTypography from '@/hooks/useAdaptiveTypography';
import {
    startGazeSession, recordLineGaze, recordRereadEvent,
    recordAdaptiveLevel, endGazeSession, getCurrentSessionSnapshot,
    recordWordRead, recordWordStruggle, recordFusionStats,
} from '@/services/gazeAnalytics';
import { getApiBaseUrl } from '@/lib/api';
// Lip sync + fusion
import LipSyncEngine from '@/services/LipSyncEngine';
import FusionEngine from '@/services/FusionEngine';
import { WordRegistryManager } from '@/utils/WordRegistry';

const API_BASE_URL = getApiBaseUrl();

const TABS = [
    { id: 'notes', label: 'NeuroLex Notes', icon: FileText },
    { id: 'flashcards', label: 'Flashcards', icon: Layers },
    { id: 'quiz', label: 'Quiz', icon: HelpCircle },
    { id: 'mindmap', label: 'Mind Map', icon: Brain },
    { id: 'audio', label: 'Audio', icon: Volume2 },
];

export default function GeneratorPage() {
    return (
        <GazeProvider>
            <GeneratorPageInner />
        </GazeProvider>
    );
}

function GeneratorPageInner() {
    const router = useRouter();
    const { currentUser: user } = useAuth();
    const [inputText, setInputText] = useState('');
    const [textError, setTextError] = useState('');
    const [generating, setGenerating] = useState(false);
    const [progressStep, setProgressStep] = useState(0);
    const [activeTab, setActiveTab] = useState('notes');
    const [outputs, setOutputs] = useState<any>(null);
    const [error, setError] = useState('');
    const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const PROGRESS_STEPS = [
        '🔍 Reading your text...',
        '📝 Generating simplified notes...',
        '🃏 Creating flashcards...',
        '🧠 Building quiz questions...',
        '🗺️ Drawing mind map...',
        '⚡ Almost done, finalising...',
    ];

    const handlePDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type === 'application/pdf') {
            try {
                const pdfjsLib = await import('pdfjs-dist');
                pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map((item: any) => item.str).join(' ');
                    fullText += pageText + '\n\n';
                }

                setInputText(fullText.trim());
            } catch (err: any) {
                setError('Failed to read PDF. Please try pasting the text instead.');
            }
        } else if (file.type === 'text/plain') {
            const text = await file.text();
            setInputText(text);
        }
    };

    const generateContent = async () => {
        if (!inputText.trim()) return;
        setGenerating(true);
        setProgressStep(0);
        setError('');

        // Cycle through progress steps every ~5s while waiting
        let step = 0;
        progressTimerRef.current = setInterval(() => {
            step = Math.min(step + 1, PROGRESS_STEPS.length - 1);
            setProgressStep(step);
        }, 5000);

        // 60-second hard timeout
        abortRef.current = new AbortController();
        const timeoutId = setTimeout(() => abortRef.current?.abort(), 60000);

        try {
            const response = await fetch(`${API_BASE_URL}/content/transform`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: inputText,
                    userId: user?.uid || 'anonymous',
                }),
                signal: abortRef.current.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error('AI service is busy (rate limit). Please wait 1–2 minutes and try again.');
                }
                if (response.status === 500) {
                    throw new Error('Server processing error. Please try again with shorter text.');
                }
                throw new Error('Content generation failed. Please try again.');
            }

            const data = await response.json();
            setOutputs(data);
            setActiveTab('notes');

            // Track content generation in Firebase
            if (user?.uid) {
                logContentGeneration(user.uid, {
                    inputLength: inputText.length,
                    types: Object.keys(data).filter(k => data[k]),
                });
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setError('Request timed out (60s). Try using shorter text, or restart the backend and try again.');
            } else {
                setError(err.message || 'Failed to generate content. Please try again.');
            }
        } finally {
            clearTimeout(timeoutId);
            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
            setGenerating(false);
            setProgressStep(0);
        }
    };

    return (
        <div className="min-h-screen">
            <div className="max-w-5xl mx-4 sm:mx-auto pt-6 pb-2 content-blur-card p-4 sm:p-6 mt-4">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-foreground mb-2">
                    ✨ Content Generator
                </h1>
                <p className="text-base text-muted-foreground">
                    Generate flashcards, quizzes, mind maps and more from any topic
                </p>
            </div>

            <div className="max-w-6xl mx-4 sm:mx-auto py-8 content-blur-card p-4 sm:p-8 mt-4 mb-4">
                {!outputs ? (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-3xl mx-auto space-y-6"
                    >
                        {/* Info */}
                        <div className="rounded-2xl p-5 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
                            <div className="flex items-start gap-3">
                                <Wand2 size={22} className="text-amber-400 mt-1 shrink-0" />
                                <div>
                                    <h2 className="text-lg font-semibold mb-1">Transform Any Content</h2>
                                    <p className="text-foreground/60 text-sm">
                                        Paste text or upload a PDF, and AI will generate NeuroLex notes,
                                        flashcards, quizzes, mind maps, and audio narration.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Input */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm text-foreground/60">Paste your content</label>
                                <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer text-sm transition-colors">
                                    <Upload size={14} />
                                    Upload PDF / TXT
                                    <input
                                        type="file"
                                        accept=".pdf,.txt"
                                        onChange={handlePDFUpload}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                            <textarea
                                value={inputText}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setInputText(val);
                                    if (val.trim().length > 5) {
                                        if (!/\p{L}/u.test(val)) {
                                            setTextError('Please enter readable text — only letters, words, or sentences are accepted. Dots, spaces, or symbols alone are not valid.');
                                        } else {
                                            const nonSpace = val.replace(/\s/g, '').length;
                                            const letters = (val.match(/\p{L}/gu) || []).length;
                                            if (nonSpace > 10 && letters / nonSpace < 0.1) {
                                                setTextError('Text appears to be mostly symbols or numbers. Please enter readable content in any language.');
                                            } else {
                                                setTextError('');
                                            }
                                        }
                                    } else {
                                        setTextError('');
                                    }
                                }}
                                onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (!val) { setTextError(''); return; }
                                    if (!/\p{L}/u.test(val)) {
                                        setTextError('Please enter readable text — only letters, words, or sentences are accepted.');
                                    }
                                }}
                                rows={10}
                                placeholder="Paste lecture notes, textbook content, or any educational text..."
                                className={`w-full rounded-xl p-4 bg-white/10 backdrop-blur-md border text-foreground placeholder-foreground/30 focus:outline-none resize-none transition-colors ${
                                    textError
                                        ? 'border-red-500/70 focus:border-red-500'
                                        : 'border-white/10 focus:border-amber-500'
                                }`}
                                style={{ fontSize: '16px', lineHeight: '1.6' }}
                            />
                            {textError && (
                                <p className="mt-2 text-sm text-red-400 flex items-center gap-1.5">
                                    <span>⚠</span> {textError}
                                </p>
                            )}
                            <div className="text-right text-xs text-foreground/30 mt-1">
                                {inputText.split(/\s+/).filter(w => w).length} words
                            </div>
                        </div>

                        {/* Generate button */}
                        <motion.button
                            onClick={generateContent}
                            disabled={!inputText.trim() || generating || !!textError}
                            className="w-full py-4 rounded-xl font-semibold text-lg transition-all disabled:opacity-30"
                            style={{
                                background: inputText.trim() && !generating && !textError
                                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                    : '#333',
                            }}
                            whileHover={inputText.trim() && !generating && !textError ? { scale: 1.02 } : {}}
                            whileTap={inputText.trim() && !generating && !textError ? { scale: 0.98 } : {}}
                        >
                            {generating ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 size={20} className="animate-spin flex-shrink-0" />
                                    <span className="truncate">{PROGRESS_STEPS[progressStep]}</span>
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <Wand2 size={20} />
                                    Generate Learning Content
                                </span>
                            )}
                        </motion.button>

                        {error && (
                            <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                                {error}
                            </div>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-6"
                    >
                        {/* Back & tabs */}
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => setOutputs(null)}
                                className="flex items-center gap-2 text-foreground/60 hover:text-white text-sm transition-colors"
                            >
                                <ArrowLeft size={16} />
                                New content
                            </button>
                        </div>

                        {/* Tab bar */}
                        <div className="flex gap-2 overflow-x-auto pb-2">
                            {TABS.map((tab) => {
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${activeTab === tab.id
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                            : 'bg-white/5 text-foreground/60 border border-white/10 hover:bg-white/10'
                                            }`}
                                    >
                                        <Icon size={16} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Tab content */}
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                            >
                                {activeTab === 'notes' && <NotesViewGaze content={outputs.simplifiedNotes} />}
                                {activeTab === 'flashcards' && <FlashcardView cards={outputs.flashcards} />}
                                {activeTab === 'quiz' && <QuizView questions={outputs.quiz} userId={user?.uid} />}
                                {activeTab === 'mindmap' && <MindMapView data={outputs.mindMap} />}
                                {activeTab === 'audio' && <AudioView text={outputs.simplifiedNotes} />}
                            </motion.div>
                        </AnimatePresence>
                    </motion.div>
                )}
            </div>
        </div>
    );
}

// ---- Sub-components ----

function breakIntoSyllables(word) {
    const punctMatch = word.match(/^([^a-zA-Z]*)(.*?)([^a-zA-Z]*)$/);
    if (!punctMatch) return word;
    const [, leadPunct, core, trailPunct] = punctMatch;
    if (core.length < 6) return word;

    const lower = core.toLowerCase();
    const syllables: string[] = [];
    let current = '';
    const vowels = 'aeiouy';
    const isVowel = (c) => vowels.includes(c);

    for (let i = 0; i < core.length; i++) {
        current += core[i];
        if (i < core.length - 1) {
            const curIsVowel = isVowel(lower[i]);
            const nextIsVowel = isVowel(lower[i + 1]);
            if (curIsVowel && !nextIsVowel && i + 2 < core.length && isVowel(lower[i + 2])) {
                syllables.push(current); current = '';
            } else if (!curIsVowel && !nextIsVowel && current.length > 1 && i + 1 < core.length - 1) {
                const blend = lower[i] + lower[i + 1];
                const commonBlends = ['bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'ph', 'pl', 'pr', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'th', 'tr', 'tw', 'wh', 'wr'];
                if (!commonBlends.includes(blend)) { syllables.push(current); current = ''; }
            } else if (!curIsVowel && nextIsVowel && current.length > 2) {
                const lastChar = current[current.length - 1];
                syllables.push(current.slice(0, -1)); current = lastChar;
            }
        }
    }
    if (current) syllables.push(current);
    if (syllables.length <= 1) return word;
    return leadPunct + syllables.join('\u00b7') + trailPunct;
}

function NotesView({ content }) {
    const [syllableMode, setSyllableMode] = useState(false);

    // Strip markdown symbols (# * **) and clean up for plain reading
    const cleanContent = (text) => {
        if (!text) return 'No notes generated.';
        return text
            .replace(/#{1,6}\s*/g, '')       // Remove # headings
            .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove **bold** markers
            .replace(/\*([^*]+)\*/g, '$1')     // Remove *italic* markers
            .replace(/^[-\u2022]\s*/gm, '  \u2022 ')  // Normalize bullet markers to bullet char
            .replace(/^\d+\.\s*/gm, (m) => '  ' + m) // Indent numbered lists
            .trim();
    };

    const renderText = (text) => {
        if (!syllableMode) return text;
        return text.split(/\s+/).map((word, i) => {
            if (word.replace(/[^a-zA-Z]/g, '').length >= 6) {
                const broken = breakIntoSyllables(word);
                const parts = broken.split('\u00b7');
                if (parts.length > 1) {
                    return (
                        <span key={i}>
                            {parts.map((part, pi) => (
                                <span key={pi}>
                                    {part}
                                    {pi < parts.length - 1 && (
                                        <span className="text-purple-400 font-bold mx-[1px]">{'\u00b7'}</span>
                                    )}
                                </span>
                            ))}{' '}
                        </span>
                    );
                }
            }
            return <span key={i}>{word} </span>;
        });
    };

    const lines = cleanContent(content).split('\n');

    return (
        <div className="reading-content rounded-2xl p-6 bg-white/5 border border-white/10">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <FileText size={20} className="text-amber-400" />
                    NeuroLex Notes
                </h3>
                <button
                    onClick={() => setSyllableMode(!syllableMode)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                        background: syllableMode ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${syllableMode ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                        color: syllableMode ? '#c084fc' : 'rgba(255,255,255,0.5)',
                    }}
                >
                    <SplitSquareHorizontal size={14} />
                    {syllableMode ? 'Syllables ON' : 'Break Down'}
                </button>
            </div>
            <div className="text-white/80 leading-loose space-y-2" style={{ fontSize: '16px' }}>
                {lines.map((line, i) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={i} className="h-2" />;
                    const isBullet = trimmed.startsWith('\u2022') || /^\d+\./.test(trimmed);
                    return (
                        <p key={i} className={isBullet ? 'pl-2' : ''}>
                            {renderText(trimmed)}
                        </p>
                    );
                })}
            </div>
        </div>
    );
}

// ---- Gaze-enhanced NotesView ----
function NotesViewGaze({ content }) {
    const { startGaze, stopGaze, gazeActive, isCalibrated, setCalibrated, faceLandmarksRef, faceMeshService } = useGaze();
    const [gazeEnabled, setGazeEnabled] = useState(false);
    const [showCalibration, setShowCalibration] = useState(false);
    const [showHeatmap, setShowHeatmap] = useState(false);
    const [heatmapSnapshot, setHeatmapSnapshot] = useState(null);
    const [syllableMode, setSyllableMode] = useState(false);
    const containerRef = useRef(null);

    // Lip sync + fusion state
    const lipSyncRef = useRef(null);
    const fusionRef = useRef(null);
    const registryRef = useRef(null);
    const fusionLoopRef = useRef(null);
    const [lipSyncActive, setLipSyncActive] = useState(false);
    const [fusionState, setFusionState] = useState(null);
    const [struggleWords, setStruggleWords] = useState<Set<number>>(new Set());
    const [rereadWordsMap, setRereadWordsMap] = useState(new Map());
    const [showAnalytics, setShowAnalytics] = useState(false);

    const gazeReading = gazeEnabled;
    const { currentLine, rebuildRects } = useLineMapper(gazeReading ? containerRef : { current: null });
    const { rereadLines, rereadLog, resetReread } = useRereadDetector(gazeReading ? currentLine : -1, gazeReading);
    const { getLineStyle, getLineLevel, resetTypography } = useAdaptiveTypography(rereadLines, gazeReading);

    // Analytics
    useEffect(() => {
        if (gazeReading && currentLine >= 0) {
            recordLineGaze(currentLine);
            const level = getLineLevel(currentLine);
            if (level > 0) recordAdaptiveLevel(currentLine, level);
        }
    }, [currentLine, gazeReading, getLineLevel]);

    useEffect(() => {
        if (!gazeReading) return;
        const handler = (e: any) => {
            const { lineIndex, count } = e.detail;
            recordRereadEvent(lineIndex, count);
        };
        window.addEventListener('reread', handler);
        return () => window.removeEventListener('reread', handler);
    }, [gazeReading]);

    // ---- Lip Sync + Fusion lifecycle ----
    useEffect(() => {
        if (!gazeReading) {
            if (fusionLoopRef.current) cancelAnimationFrame(fusionLoopRef.current);
            if (lipSyncRef.current) { lipSyncRef.current.destroy(); lipSyncRef.current = null; }
            if (fusionRef.current) { fusionRef.current.destroy(); fusionRef.current = null; }
            if (registryRef.current) { registryRef.current.detach(); registryRef.current = null; }
            setLipSyncActive(false);
            setFusionState(null);
            return;
        }

        const cores = navigator.hardwareConcurrency || 2;
        const canLipSync = cores >= 4;

        const lipEngine = new LipSyncEngine();
        const fusionEngine = new FusionEngine();
        lipSyncRef.current = lipEngine;
        fusionRef.current = fusionEngine;

        const unsubWord = fusionEngine.onWordChange((detail) => {
            setFusionState({ confidence: detail.confidence, method: detail.method, text: detail.text });
            setRereadWordsMap(new Map(fusionEngine.rereadWords));
            recordWordRead(detail);
        });
        const unsubStruggle = fusionEngine.onWordStruggle((detail) => {
            setStruggleWords(new Set(fusionEngine.struggleWords));
            recordWordStruggle(detail);
        });

        let registryAttached = false;
        const attachRegistry = () => {
            if (!containerRef.current || registryAttached) return;
            const reg = new WordRegistryManager();
            reg.attach(containerRef.current);
            registryRef.current = reg;
            registryAttached = true;
        };
        const regTimer = setTimeout(attachRegistry, 300);

        // FaceMeshService handles detection; feed lip engine from faceLandmarksRef
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

        const gazeRef = { x: 0, y: 0 };
        const gazeHandler = (e: any) => { gazeRef.x = e.detail.x; gazeRef.y = e.detail.y; };
        window.addEventListener('gazeupdate', gazeHandler);

        let running = true;
        const fusionTick = () => {
            if (!running) return;
            if (registryRef.current && fusionRef.current) {
                let lipResult = null;
                if (lipSyncRef.current && registryRef.current) {
                    const candidates = registryRef.current.getWordCandidates(gazeRef.x, gazeRef.y);
                    if (candidates.length > 0) {
                        const match = lipSyncRef.current.matchWord(candidates.map(c => c.text));
                        if (match && !match.then && match.word) {
                            const matched = candidates.find(c => c.text === match.word);
                            if (matched) {
                                lipResult = { wordIndex: matched.wordIndex, text: matched.text, confidence: match.confidence || 0.5 };
                            }
                        }
                    }
                }
                fusionRef.current.processTick(gazeRef.x, gazeRef.y, lipResult, registryRef.current);
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

    const handleToggleGaze = useCallback(async () => {
        if (gazeEnabled) {
            if (fusionRef.current) recordFusionStats(fusionRef.current.getReadingStats());
            stopGaze();
            setGazeEnabled(false);
            const snap = getCurrentSessionSnapshot();
            setHeatmapSnapshot(snap);
            await endGazeSession();
            resetReread();
            resetTypography();
            setShowAnalytics(false);
        } else {
            const ok = await startGaze();
            if (ok) {
                setGazeEnabled(true);
                if (!isCalibrated) setShowCalibration(true);
                const lines = splitIntoReadingLines(cleanContent(content));
                startGazeSession('generator', lines.length);
            }
        }
    }, [gazeEnabled, startGaze, stopGaze, isCalibrated, content, resetReread, resetTypography]);

    const cleanContent = (text) => {
        if (!text) return 'No notes generated.';
        return text
            .replace(/#{1,6}\s*/g, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/^[-\u2022]\s*/gm, '  \u2022 ')
            .replace(/^\d+\.\s*/gm, (m) => '  ' + m)
            .trim();
    };

    const cleaned = cleanContent(content);
    const readingLines = splitIntoReadingLines(cleaned);

    return (
        <div className="reading-content rounded-2xl p-6 bg-white/5 border border-white/10">
            {showCalibration && (
                <CalibrationWizard
                    onComplete={() => setShowCalibration(false)}
                    onSkip={() => setShowCalibration(false)}
                />
            )}
            <GazePiP enabled={gazeEnabled} fusionState={fusionState} lipSyncActive={lipSyncActive} />
            <GazeDot enabled={gazeEnabled && !showCalibration} />
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <FileText size={20} className="text-amber-400" />
                    NeuroLex Notes
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setSyllableMode(!syllableMode)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                        style={{
                            background: syllableMode ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${syllableMode ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                            color: syllableMode ? '#c084fc' : 'rgba(255,255,255,0.5)',
                        }}
                    >
                        <SplitSquareHorizontal size={14} />
                        {syllableMode ? 'Syllables ON' : 'Break Down'}
                    </button>
                    {gazeEnabled && (
                        <button
                            onClick={() => {
                                setHeatmapSnapshot(getCurrentSessionSnapshot());
                                setShowHeatmap(!showHeatmap);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                            style={{
                                background: showHeatmap ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${showHeatmap ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                color: showHeatmap ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                            }}
                        >
                            <BarChart3 size={14} />
                            Heatmap
                        </button>
                    )}
                    {gazeEnabled && (
                        <button
                            onClick={() => {
                                setHeatmapSnapshot(getCurrentSessionSnapshot());
                                setShowAnalytics(!showAnalytics);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                            style={{
                                background: showAnalytics ? 'rgba(6,182,212,0.2)' : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${showAnalytics ? 'rgba(6,182,212,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                color: showAnalytics ? '#67e8f9' : 'rgba(255,255,255,0.5)',
                            }}
                        >
                            <Zap size={14} />
                            Analytics
                        </button>
                    )}
                </div>
            </div>

            <div className="relative">
                <GazeHighlighter containerRef={containerRef} currentLine={currentLine} enabled={gazeReading} />
                <WordHighlighter containerRef={containerRef} enabled={gazeReading} struggleWords={struggleWords} rereadWords={rereadWordsMap} />
                <GazeTTS containerRef={containerRef} enabled={gazeReading} />
                <div
                    ref={containerRef}
                    className="text-white/80 leading-loose space-y-2"
                    style={{ fontSize: '16px', position: 'relative' }}
                >
                    {gazeEnabled
                        ? readingLines.map((lineProps) => (
                            <div
                                key={lineProps.key}
                                data-line-index={lineProps['data-line-index']}
                                className="py-1"
                                style={getLineStyle(lineProps['data-line-index'], 16)}
                            >
                                {lineProps.children}
                            </div>
                        ))
                        : cleaned.split('\n').map((line, i) => {
                            const trimmed = line.trim();
                            if (!trimmed) return <div key={i} className="h-2" />;
                            const isBullet = trimmed.startsWith('\u2022') || /^\d+\./.test(trimmed);
                            return <p key={i} className={isBullet ? 'pl-2' : ''}>{trimmed}</p>;
                        })
                    }
                </div>
            </div>

            {showHeatmap && heatmapSnapshot && (
                <div className="mt-4 pt-4 border-t border-white/10">
                    <GazeHeatmap
                        heatmapData={heatmapSnapshot.heatmap || []}
                        rereadLines={rereadLines}
                        totalLines={heatmapSnapshot.totalLines || 0}
                        maxHeight="200px"
                    />
                </div>
            )}

            {/* Reading Analytics (word-level fusion data) */}
            <div className="mt-4">
                <ReadingAnalytics visible={showAnalytics && gazeEnabled} snapshot={heatmapSnapshot} />
            </div>
        </div>
    );
}

function FlashcardView({ cards }) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const parsedCards = typeof cards === 'string' ? parseFlashcards(cards) : (cards || []);

    const next = () => { setCurrentIndex((i) => Math.min(i + 1, parsedCards.length - 1)); setFlipped(false); };
    const prev = () => { setCurrentIndex((i) => Math.max(i - 1, 0)); setFlipped(false); };

    if (parsedCards.length === 0) {
        return <div className="text-foreground/40 text-center p-8">No flashcards generated.</div>;
    }

    return (
        <div className="space-y-4">
            <div className="text-center text-sm text-foreground/40">
                Card {currentIndex + 1} of {parsedCards.length}
            </div>
            <div
                onClick={() => setFlipped(!flipped)}
                className="relative mx-auto max-w-lg cursor-pointer"
                style={{ minHeight: '200px' }}
            >
                <AnimatePresence mode="wait">
                    {!flipped ? (
                        <motion.div
                            key="front"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.25 }}
                            className="rounded-2xl p-8 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-center flex items-center justify-center flex-col"
                            style={{ minHeight: '200px' }}
                        >
                            <div className="text-xs text-indigo-300 mb-3">QUESTION</div>
                            <div className="text-lg font-medium">{parsedCards[currentIndex]?.front}</div>
                            <div className="text-xs text-foreground/30 mt-4">Click to see answer</div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="back"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.25 }}
                            className="rounded-2xl p-8 bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 text-center flex items-center justify-center flex-col"
                            style={{ minHeight: '200px' }}
                        >
                            <div className="text-xs text-green-300 mb-3">ANSWER</div>
                            <div className="text-lg font-medium">{parsedCards[currentIndex]?.back}</div>
                            <div className="text-xs text-foreground/30 mt-4">Click to see question</div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            <div className="flex justify-center gap-3">
                <button onClick={prev} disabled={currentIndex === 0} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 transition-colors hover:bg-white/10">
                    <ChevronLeft size={18} />
                </button>
                <button onClick={next} disabled={currentIndex === parsedCards.length - 1} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30 transition-colors hover:bg-white/10">
                    <ChevronRight size={18} />
                </button>
            </div>
        </div>
    );
}

function QuizView({ questions, userId }) {
    const [answers, setAnswers] = useState({});
    const [showResults, setShowResults] = useState(false);
    const parsedQuestions = typeof questions === 'string' ? parseQuiz(questions) : (questions || []);

    const handleAnswer = (qi, ai) => {
        if (showResults) return;
        setAnswers({ ...answers, [qi]: ai });
    };

    const score = parsedQuestions.reduce((acc, q, i) => {
        return acc + (answers[i] === q.correct ? 1 : 0);
    }, 0);

    if (parsedQuestions.length === 0) {
        return <div className="text-foreground/40 text-center p-8">No quiz generated.</div>;
    }

    return (
        <div className="space-y-6">
            {parsedQuestions.map((q, qi) => (
                <div key={qi} className="rounded-xl p-5 bg-white/5 border border-white/10">
                    <div className="font-medium mb-3">{qi + 1}. {q.question}</div>
                    <div className="space-y-2">
                        {q.options.map((opt, oi) => {
                            const selected = answers[qi] === oi;
                            const isCorrect = q.correct === oi;
                            let borderColor = 'border-white/10';
                            let bgColor = 'bg-white/5';

                            if (showResults && isCorrect) {
                                borderColor = 'border-green-500/50';
                                bgColor = 'bg-green-500/10';
                            } else if (showResults && selected && !isCorrect) {
                                borderColor = 'border-red-500/50';
                                bgColor = 'bg-red-500/10';
                            } else if (selected) {
                                borderColor = 'border-indigo-500/50';
                                bgColor = 'bg-indigo-500/10';
                            }

                            return (
                                <button
                                    key={oi}
                                    onClick={() => handleAnswer(qi, oi)}
                                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${borderColor} ${bgColor}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-foreground/40">{String.fromCharCode(65 + oi)}</span>
                                        <span className="text-sm">{opt}</span>
                                        {showResults && isCorrect && <Check size={16} className="ml-auto text-green-400" />}
                                        {showResults && selected && !isCorrect && <X size={16} className="ml-auto text-red-400" />}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {!showResults ? (
                <button
                    onClick={() => {
                        setShowResults(true);
                        // Track quiz attempt in Firebase
                        const s = parsedQuestions.reduce((acc, q, i) => acc + (answers[i] === q.correct ? 1 : 0), 0);
                        if (userId) logQuizAttempt(userId, { score: s, totalQuestions: parsedQuestions.length });
                    }}
                    disabled={Object.keys(answers).length < parsedQuestions.length}
                    className="w-full py-3 rounded-xl font-semibold transition-all disabled:opacity-30"
                    style={{ background: Object.keys(answers).length >= parsedQuestions.length ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#333' }}
                >
                    Check Answers
                </button>
            ) : (
                <div className="text-center">
                    <div className="text-2xl font-bold mb-1">
                        {score}/{parsedQuestions.length}
                    </div>
                    <div className="text-foreground/50 text-sm">
                        {score === parsedQuestions.length ? '\ud83c\udf89 Perfect!' : score >= parsedQuestions.length / 2 ? '\ud83d\udc4d Good job!' : '\ud83d\udcda Keep practicing!'}
                    </div>
                    <button
                        onClick={() => { setAnswers({}); setShowResults(false); }}
                        className="mt-3 flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10 transition-colors"
                    >
                        <RefreshCw size={14} /> Retry
                    </button>
                </div>
            )}
        </div>
    );
}

function MindMapView({ data }) {
    const content = typeof data === 'string' ? data : '';

    // Parse mind map text into a tree visualization
    const lines = content.split('\n').filter(l => l.trim());

    return (
        <div className="rounded-2xl p-6 bg-white/5 border border-white/10">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Brain size={20} className="text-amber-400" />
                Mind Map
            </h3>
            <div className="font-mono text-sm text-white/80 whitespace-pre-wrap leading-loose">
                {lines.map((line, i) => {
                    const isMain = !line.startsWith('\u251c') && !line.startsWith('\u2514') && !line.startsWith('\u2502') && !line.startsWith('  ');
                    return (
                        <div key={i} className={isMain ? 'text-amber-300 font-semibold text-lg mb-2' : 'text-white/70 ml-2'}>
                            {line}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AudioView({ text }) {
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(0.85);

    const handlePlay = () => {
        if (playing) {
            window.speechSynthesis.cancel();
            setPlaying(false);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.onend = () => setPlaying(false);
        window.speechSynthesis.speak(utterance);
        setPlaying(true);
    };

    return (
        <div className="rounded-2xl p-6 bg-white/5 border border-white/10 text-center">
            <h3 className="text-lg font-semibold mb-4 flex items-center justify-center gap-2">
                <Volume2 size={20} className="text-amber-400" />
                Audio Narration
            </h3>
            <p className="text-foreground/50 text-sm mb-6">
                Listen to the content read aloud at a comfortable pace
            </p>

            <div className="flex items-center justify-center gap-4 mb-4">
                <span className="text-sm text-foreground/40">Speed:</span>
                {[0.5, 0.75, 0.85, 1.0, 1.25].map((r) => (
                    <button
                        key={r}
                        onClick={() => setRate(r)}
                        className={`px-3 py-1 rounded-lg text-sm transition-all ${rate === r ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-foreground/50 border border-white/10'
                            }`}
                    >
                        {r}x
                    </button>
                ))}
            </div>

            <motion.button
                onClick={handlePlay}
                className="px-8 py-4 rounded-xl font-semibold text-lg"
                style={{
                    background: playing ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                {playing ? (
                    <span className="flex items-center gap-2"><Volume2 size={20} /> Stop</span>
                ) : (
                    <span className="flex items-center gap-2"><Volume2 size={20} /> Play Audio</span>
                )}
            </motion.button>
        </div>
    );
}

// ---- Helpers ----

function parseFlashcards(text) {
    const cards = [];
    const lines = text.split('\n').filter(l => l.trim());
    let current = null;

    for (const line of lines) {
        const cleaned = line.replace(/^\d+[\.\)]\s*/, '').trim();
        if (cleaned.toLowerCase().startsWith('q:') || cleaned.toLowerCase().startsWith('front:') || cleaned.toLowerCase().startsWith('question:')) {
            if (current && current.front) cards.push(current);
            current = { front: cleaned.replace(/^(q|front|question):\s*/i, ''), back: '' };
        } else if (cleaned.toLowerCase().startsWith('a:') || cleaned.toLowerCase().startsWith('back:') || cleaned.toLowerCase().startsWith('answer:')) {
            if (current) current.back = cleaned.replace(/^(a|back|answer):\s*/i, '');
        }
    }
    if (current && current.front) cards.push(current);

    // Fallback: split by double newline chunks
    if (cards.length === 0) {
        const chunks = text.split(/\n\n+/);
        for (let i = 0; i < chunks.length - 1; i += 2) {
            cards.push({ front: chunks[i].trim(), back: (chunks[i + 1] || '').trim() });
        }
    }

    return cards;
}

function parseQuiz(text) {
    const questions = [];
    const blocks = text.split(/\n(?=\d+[\.\)])/);

    for (const block of blocks) {
        const lines = block.split('\n').filter(l => l.trim());
        if (lines.length < 3) continue;

        const question = lines[0].replace(/^\d+[\.\)]\s*/, '').trim();
        const options = [];
        let correct = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            const optMatch = line.match(/^[A-Da-d][\.\)]\s*(.*)/);
            if (optMatch) {
                const isCorrect = line.includes('\u2713') || line.includes('*') || line.toLowerCase().includes('(correct)');
                if (isCorrect) correct = options.length;
                options.push(optMatch[1].replace(/[\u2713*]|\(correct\)/gi, '').trim());
            }
        }

        if (options.length >= 2) {
            questions.push({ question, options, correct });
        }
    }

    return questions;
}
