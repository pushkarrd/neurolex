// AI Handwriting Error Detection Page
// Students upload handwritten work → system detects dyslexia-related writing issues
// Uses Gemini vision API via backend for analysis

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    PenTool, Upload, ArrowLeft, CheckCircle, AlertTriangle,
    Camera, RefreshCw, FileImage, Loader2, BookOpen, Target,
    Lightbulb, Star, XCircle, ChevronDown, ChevronUp, Type,
    AlignLeft, Ruler, SpellCheck, Scaling, Eye
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export default function HandwritingPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [image, setImage] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const [expandedSections, setExpandedSections] = useState({});
    const fileInputRef = useRef(null);

    const toggleSection = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

    const handleFile = (file) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file (JPG, PNG, etc.)');
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            setError(`File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB limit.`);
            return;
        }
        setImage(file);
        setImagePreview(URL.createObjectURL(file));
        setResults(null);
        setError('');
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        handleFile(file);
    }, []);

    const handleDragOver = (e) => {
        e.preventDefault();
        setDragActive(true);
    };

    const handleDragLeave = () => setDragActive(false);

    const analyzeHandwriting = async () => {
        if (!image) return;
        setAnalyzing(true);
        setError('');
        setResults(null);

        try {
            const formData = new FormData();
            formData.append('file', image);
            if (user) formData.append('userId', user.uid);

            const response = await fetch(`${API_BASE_URL}/handwriting/analyze`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Analysis failed. Please try again.');
            }

            const data = await response.json();
            setResults(data);
        } catch (err) {
            setError(err.message || 'Failed to analyze handwriting.');
        } finally {
            setAnalyzing(false);
        }
    };

    const reset = () => {
        setImage(null);
        setImagePreview(null);
        setResults(null);
        setError('');
    };

    const getErrorColor = (severity) => {
        switch (severity) {
            case 'high': return '#ef4444';
            case 'medium': return '#f59e0b';
            case 'low': return '#22c55e';
            default: return '#8b5cf6';
        }
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
                        <PenTool size={24} className="text-purple-400" />
                        <h1 className="text-xl font-bold">Handwriting Analysis</h1>
                    </div>
                    <div className="w-24" />
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Upload area */}
                    <div className="space-y-6">
                        {/* Info */}
                        <div className="rounded-2xl p-5 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                            <div className="flex items-start gap-3">
                                <PenTool size={22} className="text-purple-400 mt-1 shrink-0" />
                                <div>
                                    <h2 className="text-lg font-semibold mb-1">AI Handwriting Check</h2>
                                    <p className="text-white/60 text-sm">
                                        Upload a photo of handwritten work. Our AI will detect dyslexia-related
                                        errors like letter reversals (b/d, p/q), spacing issues, and formation problems.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Upload zone */}
                        <div
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                            className={`relative rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${dragActive
                                ? 'border-purple-400 bg-purple-500/10'
                                : 'border-white/20 bg-white/5 hover:border-white/40'
                                }`}
                            style={{ minHeight: '250px' }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleFile(e.target.files[0])}
                                className="hidden"
                            />

                            {imagePreview ? (
                                <img
                                    src={imagePreview}
                                    alt="Handwriting preview"
                                    className="max-h-[300px] mx-auto rounded-lg object-contain"
                                />
                            ) : (
                                <div className="flex flex-col items-center gap-4 py-8">
                                    <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center">
                                        <FileImage size={32} className="text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-white/80 font-medium">Drop an image here or click to upload</p>
                                        <p className="text-white/40 text-sm mt-1">JPG, PNG — max 50 MB</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-3">
                            <motion.button
                                onClick={analyzeHandwriting}
                                disabled={!image || analyzing}
                                className="flex-1 py-3 rounded-xl font-semibold transition-all disabled:opacity-30"
                                style={{
                                    background: image && !analyzing ? 'linear-gradient(135deg, #8b5cf6, #a855f7)' : '#333',
                                }}
                                whileHover={image && !analyzing ? { scale: 1.02 } : {}}
                                whileTap={image && !analyzing ? { scale: 0.98 } : {}}
                            >
                                {analyzing ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 size={18} className="animate-spin" />
                                        Analyzing...
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center gap-2">
                                        <PenTool size={18} />
                                        Analyze Handwriting
                                    </span>
                                )}
                            </motion.button>

                            {image && (
                                <button
                                    onClick={reset}
                                    className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                                >
                                    <RefreshCw size={18} />
                                </button>
                            )}
                        </div>

                        {error && (
                            <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Right: Results */}
                    <div>
                        <AnimatePresence mode="wait">
                            {analyzing ? (
                                <motion.div
                                    key="loading"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="rounded-2xl p-8 bg-white/5 border border-white/10 flex flex-col items-center justify-center"
                                    style={{ minHeight: '400px' }}
                                >
                                    <Loader2 size={48} className="text-purple-400 animate-spin mb-4" />
                                    <p className="text-white/60">Analyzing handwriting patterns...</p>
                                    <p className="text-white/40 text-sm mt-2">Extracting text, checking spelling, scoring each category...</p>
                                </motion.div>
                            ) : results ? (
                                <motion.div
                                    key="results"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-4"
                                >
                                    {/* Overall Score */}
                                    <div className="rounded-2xl p-6 bg-white/5 border border-white/10">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-semibold text-lg">Analysis Results</h3>
                                            <div
                                                className="px-4 py-1.5 rounded-full text-sm font-bold"
                                                style={{
                                                    backgroundColor: results.score >= 80 ? 'rgba(34, 197, 94, 0.2)' :
                                                        results.score >= 50 ? 'rgba(245, 158, 11, 0.2)' :
                                                            'rgba(239, 68, 68, 0.2)',
                                                    color: results.score >= 80 ? '#22c55e' :
                                                        results.score >= 50 ? '#f59e0b' : '#ef4444',
                                                }}
                                            >
                                                {results.score}/100
                                            </div>
                                        </div>
                                        <p className="text-white/60 text-sm">{results.summary}</p>

                                        {/* Score breakdown legend */}
                                        <div className="mt-3 pt-3 border-t border-white/5 text-xs text-white/30">
                                            Score = Letter Formation (25%) + Spelling (25%) + Spacing (15%) + Alignment (15%) + Sizing (10%) + Legibility (10%)
                                        </div>
                                    </div>

                                    {/* Category Scores */}
                                    {results.categoryScores && (
                                        <div className="rounded-2xl p-5 bg-white/5 border border-white/10">
                                            <button
                                                onClick={() => toggleSection('categories')}
                                                className="w-full flex items-center justify-between mb-4"
                                                style={{ minHeight: 'auto' }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Target size={18} className="text-purple-400" />
                                                    <h4 className="font-medium text-sm">Category Breakdown</h4>
                                                </div>
                                                {expandedSections.categories === false ? <ChevronDown size={16} className="text-white/40" /> : <ChevronUp size={16} className="text-white/40" />}
                                            </button>
                                            {expandedSections.categories !== false && (
                                                <div className="space-y-3">
                                                    {[
                                                        { key: 'letterFormation', label: 'Letter Formation', icon: <Type size={14} />, desc: 'Shape accuracy, reversals (b/d, p/q)' },
                                                        { key: 'spacing', label: 'Spacing', icon: <AlignLeft size={14} />, desc: 'Between letters, words, and lines' },
                                                        { key: 'alignment', label: 'Alignment', icon: <Ruler size={14} />, desc: 'Baseline consistency, slant' },
                                                        { key: 'spelling', label: 'Spelling', icon: <SpellCheck size={14} />, desc: 'Correct spelling, no abbreviations' },
                                                        { key: 'sizing', label: 'Sizing', icon: <Scaling size={14} />, desc: 'Consistent letter heights' },
                                                        { key: 'legibility', label: 'Legibility', icon: <Eye size={14} />, desc: 'Overall readability' },
                                                    ].map(({ key, label, icon, desc }) => {
                                                        const val = results.categoryScores[key] ?? 50;
                                                        const color = val >= 80 ? '#22c55e' : val >= 50 ? '#f59e0b' : '#ef4444';
                                                        return (
                                                            <div key={key}>
                                                                <div className="flex items-center justify-between text-sm mb-1">
                                                                    <div className="flex items-center gap-2 text-white/70">
                                                                        <span className="text-purple-400">{icon}</span>
                                                                        {label}
                                                                    </div>
                                                                    <span style={{ color }} className="font-medium text-sm">{val}/100</span>
                                                                </div>
                                                                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                                                    <motion.div
                                                                        initial={{ width: 0 }}
                                                                        animate={{ width: `${val}%` }}
                                                                        transition={{ duration: 0.8, delay: 0.2 }}
                                                                        className="h-full rounded-full"
                                                                        style={{ backgroundColor: color }}
                                                                    />
                                                                </div>
                                                                <p className="text-[10px] text-white/30 mt-0.5">{desc}</p>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Extracted Text */}
                                    {results.extractedText && (
                                        <div className="rounded-2xl p-5 bg-white/5 border border-white/10">
                                            <button
                                                onClick={() => toggleSection('extracted')}
                                                className="w-full flex items-center justify-between mb-3"
                                                style={{ minHeight: 'auto' }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <BookOpen size={18} className="text-blue-400" />
                                                    <h4 className="font-medium text-sm">Extracted Text</h4>
                                                </div>
                                                {expandedSections.extracted === false ? <ChevronDown size={16} className="text-white/40" /> : <ChevronUp size={16} className="text-white/40" />}
                                            </button>
                                            {expandedSections.extracted !== false && (
                                                <div className="text-sm text-white/60 bg-black/20 rounded-xl p-4 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                                                    {highlightExtractedText(results.extractedText, results.spellingErrors)}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Spelling & Language Errors */}
                                    {results.spellingErrors && results.spellingErrors.length > 0 && (
                                        <div className="rounded-2xl p-5 bg-red-500/5 border border-red-500/20">
                                            <button
                                                onClick={() => toggleSection('spelling')}
                                                className="w-full flex items-center justify-between mb-3"
                                                style={{ minHeight: 'auto' }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <XCircle size={18} className="text-red-400" />
                                                    <h4 className="font-medium text-sm">Spelling & Language Errors ({results.spellingErrors.length})</h4>
                                                </div>
                                                {expandedSections.spelling === false ? <ChevronDown size={16} className="text-white/40" /> : <ChevronUp size={16} className="text-white/40" />}
                                            </button>
                                            {expandedSections.spelling !== false && (
                                                <div className="space-y-2">
                                                    {results.spellingErrors.map((se, i) => (
                                                        <div key={i} className="flex items-center gap-3 text-sm p-2 rounded-lg bg-black/20">
                                                            <span className="text-red-400 line-through font-mono">{se.wrong}</span>
                                                            <span className="text-white/30">→</span>
                                                            <span className="text-green-400 font-mono">{se.correct}</span>
                                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/40 ml-auto">
                                                                {se.type === 'abbreviation' ? '📝 Abbreviation' :
                                                                    se.type === 'missing_letter' ? '🔤 Missing Letter' :
                                                                        se.type === 'extra_letter' ? '➕ Extra Letter' :
                                                                            se.type === 'transposition' ? '🔄 Transposed' : '❌ Misspelling'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Detected Issues */}
                                    {results.errors && results.errors.length > 0 && (
                                        <div className="rounded-2xl p-5 bg-white/5 border border-white/10">
                                            <button
                                                onClick={() => toggleSection('errors')}
                                                className="w-full flex items-center justify-between mb-3"
                                                style={{ minHeight: 'auto' }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <AlertTriangle size={18} className="text-amber-400" />
                                                    <h4 className="font-medium text-sm">Detected Issues ({results.errors.length})</h4>
                                                </div>
                                                {expandedSections.errors === false ? <ChevronDown size={16} className="text-white/40" /> : <ChevronUp size={16} className="text-white/40" />}
                                            </button>
                                            {expandedSections.errors !== false && (
                                                <div className="space-y-3">
                                                    {results.errors.map((err, i) => (
                                                        <motion.div
                                                            key={i}
                                                            initial={{ opacity: 0, x: -20 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            transition={{ delay: i * 0.05 }}
                                                            className="rounded-xl p-4 bg-black/20 border-l-3"
                                                            style={{ borderLeftColor: getErrorColor(err.severity), borderLeftWidth: '3px' }}
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <AlertTriangle
                                                                    size={16}
                                                                    style={{ color: getErrorColor(err.severity) }}
                                                                    className="mt-0.5 shrink-0"
                                                                />
                                                                <div className="flex-1">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className="font-medium text-sm">{err.type}</span>
                                                                        <span className="text-[10px] px-2 py-0.5 rounded-full"
                                                                            style={{
                                                                                backgroundColor: `${getErrorColor(err.severity)}20`,
                                                                                color: getErrorColor(err.severity),
                                                                            }}
                                                                        >
                                                                            {err.severity}
                                                                        </span>
                                                                    </div>
                                                                    {err.word && (
                                                                        <div className="mt-1 text-xs">
                                                                            <span className="text-white/40">Found: </span>
                                                                            <span className="text-red-400 font-mono">"{err.word}"</span>
                                                                            {err.correction && (
                                                                                <>
                                                                                    <span className="text-white/40 mx-1">→</span>
                                                                                    <span className="text-green-400 font-mono">"{err.correction}"</span>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div className="text-white/50 text-xs mt-1">{err.description}</div>
                                                                    {err.suggestion && (
                                                                        <div className="mt-2 text-xs text-indigo-300 bg-indigo-500/10 rounded-lg p-2">
                                                                            💡 {err.suggestion}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Strengths */}
                                    {results.strengths && results.strengths.length > 0 && (
                                        <div className="rounded-2xl p-5 bg-green-500/5 border border-green-500/20">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Star size={18} className="text-green-400" />
                                                <h4 className="font-medium text-sm">Strengths</h4>
                                            </div>
                                            <ul className="space-y-2">
                                                {results.strengths.map((s, i) => (
                                                    <li key={i} className="text-sm text-white/60 flex items-start gap-2">
                                                        <CheckCircle size={14} className="text-green-400 mt-0.5 shrink-0" />
                                                        {s}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {/* Recommendations */}
                                    {results.recommendations && results.recommendations.length > 0 && (
                                        <div className="rounded-2xl p-5 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/20">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Lightbulb size={18} className="text-purple-400" />
                                                <h4 className="font-medium text-sm">How to Improve (Dyslexia-Friendly Tips)</h4>
                                            </div>
                                            <div className="space-y-3">
                                                {results.recommendations.map((rec, i) => {
                                                    const isObj = typeof rec === 'object';
                                                    const title = isObj ? rec.title : '';
                                                    const desc = isObj ? rec.description : rec;
                                                    const priority = isObj ? rec.priority : 'medium';
                                                    return (
                                                        <div key={i} className="p-3 rounded-xl bg-black/20">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                {priority === 'high' && <span className="text-red-400 text-[10px] font-bold uppercase">High Priority</span>}
                                                                {priority === 'medium' && <span className="text-amber-400 text-[10px] font-bold uppercase">Medium</span>}
                                                                {priority === 'low' && <span className="text-green-400 text-[10px] font-bold uppercase">Nice to do</span>}
                                                                {title && <span className="text-sm font-medium text-white/80">{title}</span>}
                                                            </div>
                                                            <p className="text-sm text-white/50">{desc}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="empty"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="rounded-2xl p-8 bg-white/5 border border-white/10 flex flex-col items-center justify-center text-center"
                                    style={{ minHeight: '400px' }}
                                >
                                    <PenTool size={48} className="text-white/20 mb-4" />
                                    <p className="text-white/40">Upload a handwriting image to see analysis results</p>
                                    <p className="text-white/30 text-sm mt-2">
                                        The AI checks letter formation, spelling, spacing, alignment, sizing & legibility
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper: highlight spelling errors in extracted text
function highlightExtractedText(text, spellingErrors) {
    if (!spellingErrors || spellingErrors.length === 0) return text;

    const parts = [];
    let remaining = text;
    const sortedErrors = [...spellingErrors].sort((a, b) => {
        const idxA = text.toLowerCase().indexOf(a.wrong.toLowerCase());
        const idxB = text.toLowerCase().indexOf(b.wrong.toLowerCase());
        return idxA - idxB;
    });

    for (const err of sortedErrors) {
        const idx = remaining.toLowerCase().indexOf(err.wrong.toLowerCase());
        if (idx === -1) continue;
        if (idx > 0) parts.push(remaining.substring(0, idx));
        parts.push(
            <span key={parts.length} className="relative group cursor-help">
                <span className="bg-red-500/30 text-red-300 px-0.5 rounded underline decoration-wavy decoration-red-400">
                    {remaining.substring(idx, idx + err.wrong.length)}
                </span>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-xs text-white rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    → {err.correct} ({err.type})
                </span>
            </span>
        );
        remaining = remaining.substring(idx + err.wrong.length);
    }

    if (remaining) parts.push(remaining);
    return parts.length > 0 ? parts : text;
}