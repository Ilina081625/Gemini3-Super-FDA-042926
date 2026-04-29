/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { 
  FileText, 
  Upload, 
  Trash2, 
  Play, 
  StopCircle, 
  Terminal, 
  LayoutDashboard, 
  Settings, 
  ChevronRight, 
  Sparkles, 
  Scissors, 
  Download,
  Languages,
  Activity,
  Zap,
  Globe,
  Database,
  Search,
  MessageSquare,
  Cpu,
  BrainCircuit,
  Eye,
  Type
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { PDFDocument } from 'pdf-lib';
import { cn, formatBytes } from './lib/utils';

// --- Constants & Defaults ---

const DEFAULT_SKILL = `轉檔：EPUB / PDF / DOCX / Facebook JSON → Obsidian Markdown
將電子書、報告、文件或社群平台匯出轉成乾淨的 Markdown。

Origional design:
來源格式 輸出位置 媒體位置
EPUB / PDF / DOCX raw/books/ raw/books/assets/
Facebook JSON 匯出 raw/notes/social/facebook/ raw/notes/social/facebook/assets/

清理規則清單:
1. 移除 pandoc 屬性並清理多餘空行
2. 中英文間距統一（pangu spacing）
3. 轉換為帶語言標籤的 fenced code block
4. 提取 metadata 寫入 YAML Frontmatter
5. 建立 Obsidian 雙向連結 [[CONCEPT]]
`;

const MODELS = [
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (快速)' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (精確)' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (新一代)' }
];

const LANGUAGES = [
  { id: 'zh-TW', name: '繁體中文 (Traditional Chinese)' },
  { id: 'en', name: '英文 (English)' }
];

const AI_MAGICS = [
  { id: 'reconstruct', name: '語意修復 (Reconstruct)', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'link', name: '自動關聯 (Entity Linking)', icon: <Globe className="w-4 h-4" /> },
  { id: 'summarize', name: '深度摘要 (Deep Summary)', icon: <BrainCircuit className="w-4 h-4" /> },
  { id: 'extract', name: '數據提取 (Data Extraction)', icon: <Database className="w-4 h-4" /> },
  { id: 'check', name: '邏輯校對 (Logic Check)', icon: <Zap className="w-4 h-4" /> },
  { id: 'shift', name: '風格切換 (Style Shift)', icon: <Languages className="w-4 h-4" /> }
];

const VISUAL_EFFECTS = [
  { id: 'none', name: '無效果 (Standard)' },
  { id: 'matrix', name: '駭客任務 (Matrix Code)' },
  { id: 'pulse', name: '能量脈衝 (Energy Pulse)' },
  { id: 'glow', name: '柔光映射 (Soft Glow)' },
  { id: 'stagger', name: '階梯進入 (Stagger In)' },
  { id: 'scan', name: '系統掃描 (Scanline)' }
];

// --- Types ---

interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string; // for text
  base64?: string; // for PDF
  status: 'pending' | 'processing' | 'done' | 'error';
}

interface LogEntry {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function App() {
  // --- State ---
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [skillMd, setSkillMd] = useState(DEFAULT_SKILL);
  const [customPrompt, setCustomPrompt] = useState('請根據提供的內容，使用 skill.md 的指導進行深度知識轉換。');
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [outputLanguage, setOutputLanguage] = useState(LANGUAGES[0].id);
  const [visualEffect, setVisualEffect] = useState(VISUAL_EFFECTS[0].id);
  
  const [output, setOutput] = useState('');
  const [activeTab, setActiveTab] = useState<'markdown' | 'preview'>('markdown');
  const [isGenerating, setIsGenerating] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [trimRange, setTrimRange] = useState({ start: 1, end: 5 });
  const [trimmingFileId, setTrimmingFileId] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- Handlers ---

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substring(7),
      time: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [...prev, newLog]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    for (const file of Array.from(uploadedFiles)) {
      addLog(`正在讀取檔案: ${file.name}`);
      const id = Math.random().toString(36).substring(7);
      
      let base64: string | undefined;
      let content = '';

      if (file.type === 'application/pdf') {
        base64 = await fileToBase64(file);
      } else {
        content = await file.text();
      }

      const newFile: AttachedFile = {
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        content,
        base64,
        status: 'pending'
      };

      setFiles(prev => [...prev, newFile]);
      addLog(`檔案讀取成功: ${file.name}`, 'success');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    addLog(`移除檔案 [ID: ${id}]`, 'warning');
  };

  const trimPdf = async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file || !file.base64) return;

    addLog(`正在裁切 PDF: ${file.name} (頁碼 ${trimRange.start}-${trimRange.end})`);
    
    try {
      const existingPdfBytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const newPdfDoc = await PDFDocument.create();
      
      const totalPages = pdfDoc.getPageCount();
      const start = Math.max(1, trimRange.start) - 1;
      const end = Math.min(totalPages, trimRange.end) - 1;

      if (start > end) throw new Error('無效的裁切範圍');

      const pagesToCopy = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      const copiedPages = await newPdfDoc.copyPages(pdfDoc, pagesToCopy);
      copiedPages.forEach(page => newPdfDoc.addPage(page));

      const pdfBytes = await newPdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `trimmed_${file.name}`;
      a.click();
      URL.revokeObjectURL(url);

      addLog(`PDF 裁切成功並已啟動下載: ${file.name}`, 'success');
    } catch (err) {
      addLog(`PDF 裁切失敗: ${err}`, 'error');
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      addLog('由使用者終止執行', 'error');
    }
  };

  const executeTransformation = async (isMagic: boolean = false, magicType?: string) => {
    if (files.length === 0 && !pastedText) {
      addLog('未提供輸入資料', 'error');
      return;
    }

    setIsGenerating(true);
    setOutput('');
    addLog(`開始 ${isMagic ? 'AI 魔術' : '深度知識轉換'} - 模型: ${selectedModel}`);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const parts: any[] = [];
      
      // Add System Prompt & Skills
      parts.push({ text: `你是一位資深的知識工程師與 Obsidian 專家。請使用以下 skill.md 規範來處理文檔。
輸出語言: ${outputLanguage === 'zh-TW' ? '繁體中文' : 'English'} (嚴格遵守)。
目標字數: 3000~4000 字。

[skill.md]
${skillMd}

[使用者自定義提示詞]
${customPrompt}
${isMagic ? `[魔術指令]: 請應用 ${magicType} 協議來強化原本的輸出。` : ''}
` });

      // Add Files
      files.forEach(f => {
        if (f.base64) {
          parts.push({ inlineData: { mimeType: 'application/pdf', data: f.base64 } });
          addLog(`加入 PDF 數據: ${f.name}`);
        } else {
          parts.push({ text: `文檔名稱: ${f.name}\n內容:\n${f.content}` });
          addLog(`加入文字/MD 數據: ${f.name}`);
        }
      });

      if (pastedText) {
        parts.push({ text: `貼上內容:\n${pastedText}` });
        addLog('加入貼上區域的內容');
      }

      const streamResponse = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [{ role: 'user', parts }]
      });
      
      for await (const chunk of streamResponse) {
        const c = chunk as GenerateContentResponse;
        const text = c.text || '';
        setOutput(prev => prev + text);
        if (outputEndRef.current) {
          outputEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
      }

      addLog('流程執行完畢', 'success');
    } catch (err) {
      addLog(`發生錯誤: ${err}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Render Helpers ---

  const renderEffectOverlay = () => {
    if (!isGenerating && visualEffect === 'none') return null;
    
    switch (visualEffect) {
      case 'matrix':
        return (
          <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10">
            <div className="animate-pulse bg-green-500/20 w-full h-full flex flex-wrap gap-1 text-[10px] font-mono p-2">
              {Array.from({ length: 100 }).map((_, i) => (
                <span key={i}>{Math.random() > 0.5 ? '1' : '0'}</span>
              ))}
            </div>
          </div>
        );
      case 'pulse':
        return (
          <motion.div 
            animate={{ opacity: [0.3, 0.6, 0.3] }} 
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute inset-0 border-2 border-blue-400 pointer-events-none rounded-xl"
          />
        );
      case 'scan':
        return (
          <div className="absolute inset-0 pointer-events-none overflow-hidden ">
            <motion.div 
              animate={{ top: ['0%', '100%'] }} 
              transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
              className="absolute w-full h-[2px] bg-slate-400/30 shadow-[0_0_15px_rgba(100,116,139,0.5)]"
            />
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans selection:bg-indigo-100">
      {/* --- Left Sidebar: Control Dashboard --- */}
      <aside className="w-80 border-r border-slate-200 bg-white flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-slate-800">Agent v3.0</h1>
          </div>
          <motion.div animate={isGenerating ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
            <Activity className={cn("w-4 h-4", isGenerating ? "text-indigo-500" : "text-slate-300")} />
          </motion.div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Config Module */}
          <section className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <Settings className="w-3 h-3" /> 模型配置
            </label>
            <select 
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-slate-100 border-none rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
            >
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-medium">輸出語言</span>
                <select 
                  value={outputLanguage}
                  onChange={(e) => setOutputLanguage(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none"
                >
                  {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-medium">視覺特效</span>
                <select 
                  value={visualEffect}
                  onChange={(e) => setVisualEffect(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs outline-none"
                >
                  {VISUAL_EFFECTS.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Skill Editor */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <Type className="w-3 h-3" /> Skill Definition (.md)
            </label>
            <textarea 
              value={skillMd}
              onChange={(e) => setSkillMd(e.target.value)}
              placeholder="貼入你的知識轉換腳本..."
              className="w-full h-32 bg-slate-900 text-slate-300 font-mono text-[10px] p-3 rounded-lg border-none outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none leading-relaxed"
            />
          </section>

          {/* Prompt Mod */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <MessageSquare className="w-3 h-3" /> 系統指令
            </label>
            <textarea 
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="w-full h-20 bg-slate-100 border-none rounded-lg p-3 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            />
          </section>

          {/* Action Module */}
          <div className="pt-4 space-y-3">
            <button 
              onClick={() => executeTransformation()}
              disabled={isGenerating}
              className={cn(
                "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98]",
                isGenerating 
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                  : "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-500/20"
              )}
            >
              {isGenerating ? <LayoutDashboard className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              {isGenerating ? "處理中..." : "開始執行"}
            </button>
            
            {isGenerating && (
              <button 
                onClick={handleStop}
                className="w-full py-3 border border-red-200 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 flex items-center justify-center gap-2 transition-colors"
              >
                <StopCircle className="w-4 h-4" /> 終止任務
              </button>
            )}
          </div>
        </div>

        {/* System Telemetry */}
        <div className="p-4 bg-slate-900 border-t border-slate-800">
          <div className="flex items-center justify-between mb-3 text-[10px] text-slate-500 font-mono uppercase">
            <span>Hardware Monitoring</span>
            <span className={cn(isGenerating ? "text-green-500" : "text-indigo-500")}>{isGenerating ? "Active" : "Idle"}</span>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>CPU Load</span>
                <span>{isGenerating ? "78%" : "12%"}</span>
              </div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div animate={{ width: isGenerating ? '78%' : '12%' }} className="h-full bg-indigo-500" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>Buffer RAM</span>
                <span>{isGenerating ? "1.2GB" : "0.4GB"}</span>
              </div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div animate={{ width: isGenerating ? '60%' : '15%' }} className="h-full bg-slate-600" />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* --- Main Content: Dynamic Agentic Flow --- */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50/50">
        {/* Top Header: Navigation & Context */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-1 text-sm text-slate-400 font-medium">
               <span>Projects</span>
               <ChevronRight className="w-4 h-4" />
               <span className="text-slate-800">Current Session</span>
             </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => setActiveTab('markdown')}
                  className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", activeTab === 'markdown' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                >
                  編輯器
                </button>
                <button 
                  onClick={() => setActiveTab('preview')}
                  className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", activeTab === 'preview' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                >
                  預覽視窗
                </button>
             </div>
          </div>
        </header>

        {/* Grid Layout for Processing & Results */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-12 gap-6 content-start">
          
          {/* File Queue & Ingestion Dashboard (Col 4) */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold flex items-center justify-between gap-2 text-slate-800">
                   <Upload className="w-5 h-5 text-indigo-500" /> 資料彙整區段
                </h3>
              </div>

              {/* Upload Dropzone */}
              <label className="border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-indigo-400 hover:bg-slate-50 transition-all group overflow-hidden relative">
                <input type="file" multiple onChange={handleFileUpload} className="hidden" />
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-6 h-6 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700">拖放或點擊上傳文檔</p>
                  <p className="text-xs text-slate-400 mt-1">支援 PDF, TXT, MD, EPUB, DOCX</p>
                </div>
              </label>

              {/* Paste Zone */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                 <textarea 
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="或者直接貼上文字內容..."
                  className="w-full h-24 bg-slate-50 border-none rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                 />
              </div>

              {/* PDF Trimmer Controls */}
              <AnimatePresence>
                {files.some(f => f.type === 'application/pdf') && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-6 pt-6 border-t border-slate-100"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold text-slate-500 flex items-center gap-2">
                        <Scissors className="w-3.5 h-3.5" /> PDF 裁切工具
                      </h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400">起始頁碼</span>
                        <input 
                          type="number" 
                          value={trimRange.start}
                          onChange={(e) => setTrimRange(prev => ({ ...prev, start: parseInt(e.target.value) }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-xs" 
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400">結束頁碼</span>
                        <input 
                          type="number" 
                          value={trimRange.end}
                          onChange={(e) => setTrimRange(prev => ({ ...prev, end: parseInt(e.target.value) }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-xs" 
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* File List */}
              <div className="mt-6 space-y-3">
                {files.map(file => (
                  <div key={file.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <FileText className="w-5 h-5 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">{formatBytes(file.size)} • {file.type.split('/')[1]}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {file.type === 'application/pdf' && (
                        <button onClick={() => trimPdf(file.id)} className="p-2 hover:bg-indigo-100 text-indigo-500 rounded-lg" title="裁切並下載">
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => removeFile(file.id)} className="p-2 hover:bg-red-100 text-red-500 rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Magic Panels */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm overflow-hidden relative">
               <div className="flex items-center gap-2 mb-6">
                 <Sparkles className="w-5 h-5 text-amber-500" />
                 <h3 className="font-bold text-slate-800">AI Magic 協議</h3>
               </div>
               <div className="grid grid-cols-2 gap-3">
                  {AI_MAGICS.map((magic) => (
                    <button 
                      key={magic.id} 
                      onClick={() => executeTransformation(true, magic.name)}
                      disabled={isGenerating || !output}
                      className="flex items-center gap-2 px-3 py-3 bg-slate-50 border border-slate-100 rounded-xl text-[11px] font-bold text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      <span className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">{magic.icon}</span>
                      {magic.name}
                    </button>
                  ))}
               </div>
            </div>
          </div>

          {/* Visualization & Output Panel (Col 8) */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
            
            {/* Live Terminal Log */}
            <div className="bg-slate-900 rounded-2xl p-4 shadow-xl border border-slate-800 h-48 flex flex-col overflow-hidden relative">
               <div className="flex items-center justify-between mb-2">
                 <div className="flex items-center gap-2">
                   <Terminal className="w-4 h-4 text-emerald-400" />
                   <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">System Live Telemetry</span>
                 </div>
                 <div className="flex gap-1.5">
                   <div className="w-2 h-2 rounded-full bg-red-500/20 shadow-[0_0_5px_rgba(239,68,68,0.5)]" />
                   <div className="w-2 h-2 rounded-full bg-amber-500/20 shadow-[0_0_5px_rgba(245,158,11,0.5)]" />
                   <div className="w-2 h-2 rounded-full bg-emerald-500/20 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                 </div>
               </div>
               <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[10px] pr-2">
                  {logs.map((log) => (
                    <div key={log.id} className="flex gap-3 leading-relaxed">
                      <span className="text-slate-600 shrink-0">[{log.time}]</span>
                      <span className={cn(
                        log.type === 'success' ? 'text-emerald-400' : 
                        log.type === 'error' ? 'text-red-400' : 
                        log.type === 'warning' ? 'text-amber-400' : 
                        'text-indigo-300'
                      )}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
               </div>
               <div className="absolute bottom-4 right-4 animate-pulse">
                 <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,1)]" />
               </div>
            </div>

            {/* Markdown Output Container */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl flex flex-col min-h-[600px] relative overflow-hidden group">
               
               {renderEffectOverlay()}
               
               <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/30">
                 <div className="flex items-center gap-3">
                   <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center">
                     <FileText className="w-5 h-5 text-indigo-500" />
                   </div>
                   <div>
                     <span className="text-[10px] text-slate-400 font-mono text-slate-400 uppercase tracking-widest block leading-none">Synthesized Output</span>
                     <h3 className="font-bold text-sm text-slate-800">知識庫轉換報告</h3>
                   </div>
                 </div>
                 <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold text-slate-400">
                      WORD COUNT: <span className="text-indigo-600">{output.trim().split(/\s+/).length}</span>
                    </span>
                    <button className="p-2 hover:bg-slate-200 rounded-lg text-slate-400" onClick={() => {
                        const blob = new Blob([output], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'Knowledge_Output.md';
                        a.click();
                        URL.revokeObjectURL(url);
                    }}>
                      <Download className="w-4 h-4" />
                    </button>
                 </div>
               </div>

               <div className="flex-1 p-8 overflow-y-auto">
                 {activeTab === 'markdown' ? (
                   <textarea 
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    className="w-full h-full min-h-[500px] border-none outline-none font-mono text-sm text-slate-700 leading-relaxed resize-none p-0 bg-transparent"
                    placeholder={isGenerating ? "正在接收數據流..." : "文檔內容將會出現在這裡..."}
                   />
                 ) : (
                   <div className="markdown-body">
                     <ReactMarkdown>{output}</ReactMarkdown>
                   </div>
                 )}
                 <div ref={outputEndRef} />
               </div>

               {/* Chat Interaction Overlay */}
               <div className="p-4 border-t border-slate-100 bg-slate-50/50 backdrop-blur-sm">
                 <div className="relative">
                   <input 
                    type="text"
                    placeholder="對此報告進行追問或調整 (例如: '將這段內容轉換成繁體中文' 或 '總結核心觀點')..."
                    className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-24 py-4 text-sm shadow-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // Action for chat sub-prompting
                        executeTransformation(true, 'Chat refinement');
                      }
                    }}
                   />
                   <div className="absolute left-4 top-1/2 -translate-y-1/2">
                     <MessageSquare className="w-5 h-5 text-indigo-400" />
                   </div>
                   <button 
                    onClick={() => executeTransformation(true, 'Refinement')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-600 transition-all flex items-center gap-2"
                   >
                     發送指令 <Zap className="w-3 h-3" />
                   </button>
                 </div>
               </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
