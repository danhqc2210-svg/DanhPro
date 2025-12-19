
import React, { useState, useCallback, useRef } from 'react';
import { VoiceName, VoiceOption, HistoryItem, TTSConfig } from './types';
import { ttsService, TTSRunResult } from './services/geminiTTS';
import { encode, createWavBlob } from './utils/audioHelper';
import mammoth from 'mammoth';

const MAX_CHARS = 50000;
const CHUNK_SIZE = 4500; 

const VOICE_OPTIONS: VoiceOption[] = [
  { id: VoiceName.ZEPHYR, name: 'Zephyr', description: 'Warm & Professional', gender: 'Male' },
  { id: VoiceName.PUCK, name: 'Puck', description: 'Energetic & Youthful', gender: 'Male' },
  { id: VoiceName.KORE, name: 'Kore', description: 'Calm & Steady', gender: 'Female' },
  { id: VoiceName.AOEDE, name: 'Aoede', description: 'Graceful & Narrative', gender: 'Female' },
  { id: VoiceName.CHARON, name: 'Charon', description: 'Deep & Authoritative', gender: 'Male' },
  { id: VoiceName.FENRIR, name: 'Fenrir', description: 'Gravely & Intense', gender: 'Male' },
];

const EMOTIONS = [
  "disdainful", "unhappy", "anxious", "hysterical", "indifferent", 
  "impatient", "guilty", "scornful", "panicked", "furious", 
  "reluctant", "keen", "disapproving", "negative", "denying", 
  "astonished", "serious", "sarcastic", "conciliative", "comforting", 
  "sincere", "sneering", "hesitating", "yielding", "painful", 
  "awkward", "amused"
];

const TONES = [
  "in a hurry tone", "shouting", "screaming", "whispering", "soft tone"
];

const EFFECTS = [
  "laughing", "chuckling", "sobbing", "crying loudly", "sighing", "panting",
  "groaning", "crowd laughing", "background laughter", "audience laughing"
];

const PROCESSING_EFFECTS = [
  { id: "reverb", label: "Reverb" },
  { id: "echo", label: "Echo" },
  { id: "distortion", label: "Distortion" }
];

const INTENSITIES = ["low", "medium", "high"];

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>(VoiceName.ZEPHYR);
  const [clonedVoices, setClonedVoices] = useState<VoiceOption[]>([]);
  const [pitch, setPitch] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TTSRunResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'emotions' | 'tones' | 'effects'>('emotions');
  const [selectedIntensity, setSelectedIntensity] = useState<string>("medium");
  
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  const insertMarker = (tag: string, intensity?: string) => {
    const formattedTag = intensity ? `(${tag}: ${intensity})` : `(${tag})`;
    if (!textAreaRef.current) return;
    const start = textAreaRef.current.selectionStart;
    const end = textAreaRef.current.selectionEnd;
    const newText = text.substring(0, start) + formattedTag + text.substring(end);
    if (newText.length > MAX_CHARS) return;
    setText(newText);
    setTimeout(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.setSelectionRange(start + formattedTag.length, start + formattedTag.length);
    }, 0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const fileName = file.name.toLowerCase();
    
    try {
      let content = "";
      if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          content = event.target?.result as string;
          if (content.length > MAX_CHARS) {
            setError(`File quá lớn! Giới hạn tối đa là ${MAX_CHARS} ký tự.`);
            setText(content.substring(0, MAX_CHARS));
          } else {
            setText(content);
          }
        };
        reader.readAsText(file);
      } else if (fileName.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        content = result.value;
        if (content.length > MAX_CHARS) {
          setError(`File quá lớn! Giới hạn tối đa là ${MAX_CHARS} ký tự.`);
          setText(content.substring(0, MAX_CHARS));
        } else {
          setText(content);
        }
      } else {
        setError("Chưa hỗ trợ định dạng này.");
      }
    } catch (err) {
      console.error(err);
      setError("Không thể đọc file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setError(null);
    try {
      const reader = new FileReader();
      reader.readAsArrayBuffer(file);
      reader.onloadend = async () => {
        const base64 = encode(new Uint8Array(reader.result as ArrayBuffer));
        await createClonedVoice(base64);
      };
    } catch (err) {
      setError("Failed to process audio file.");
    } finally {
      if (audioFileInputRef.current) audioFileInputRef.current.value = '';
    }
  };

  const splitIntoChunks = (fullText: string, size: number): string[] => {
    const chunks: string[] = [];
    let remaining = fullText;

    while (remaining.length > 0) {
      if (remaining.length <= size) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf('\n', size);
      if (splitAt === -1 || splitAt < size * 0.5) splitAt = remaining.lastIndexOf('. ', size);
      if (splitAt === -1 || splitAt < size * 0.5) splitAt = size;

      chunks.push(remaining.substring(0, splitAt + 1));
      remaining = remaining.substring(splitAt + 1);
    }
    return chunks;
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsArrayBuffer(audioBlob);
        reader.onloadend = async () => {
          const base64 = encode(new Uint8Array(reader.result as ArrayBuffer));
          await createClonedVoice(base64);
        };
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setError("Microphone access denied.");
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const createClonedVoice = async (audioBase64: string) => {
    setIsLoading(true);
    setLoadingMessage('Analyzing voice profile...');
    try {
      const profile = await ttsService.analyzeVoice(audioBase64);
      const newVoice: VoiceOption = {
        id: `custom-${Date.now()}`,
        name: `Cloned Voice ${clonedVoices.length + 1}`,
        description: profile,
        gender: 'Custom',
        isCloned: true
      };
      setClonedVoices(prev => [...prev, newVoice]);
      setSelectedVoice(newVoice.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handlePreviewVoice = async (voice: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewingId === voice.id) {
      ttsService.stop();
      setPreviewingId(null);
      setIsPlaying(false);
      return;
    }

    setPreviewingId(voice.id);
    setIsPlaying(true);
    try {
      const previewText = `Voice check for ${voice.name}. (amused) Working perfectly!`;
      const result = await ttsService.synthesize({
        text: previewText,
        voiceName: voice.id.startsWith('custom') ? VoiceName.ZEPHYR : (voice.id as VoiceName),
        pitch: 1.0,
        referenceProfile: voice.isCloned ? voice.description : undefined
      });
      await ttsService.play(result.audioBuffer, () => {
        setPreviewingId(null);
        setIsPlaying(false);
      });
    } catch (err) {
      setError("Preview failed.");
      setPreviewingId(null);
      setIsPlaying(false);
    }
  };

  const handleCheckSpelling = async () => {
    if (!text.trim()) return;
    setIsChecking(true);
    setError(null);
    try {
      const corrected = await ttsService.checkSpelling(text);
      setText(corrected.length > MAX_CHARS ? corrected.substring(0, MAX_CHARS) : corrected);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsChecking(false);
    }
  };

  const handleSynthesize = useCallback(async () => {
    if (!text.trim() || text.length > MAX_CHARS) return;
    setIsLoading(true);
    setError(null);
    
    try {
      const voiceOption = [...VOICE_OPTIONS, ...clonedVoices].find(v => v.id === selectedVoice);
      const chunks = splitIntoChunks(text, CHUNK_SIZE);
      const audioBuffers: AudioBuffer[] = [];

      for (let i = 0; i < chunks.length; i++) {
        setLoadingMessage(`Processing segment ${i + 1}/${chunks.length}...`);
        const result = await ttsService.synthesize({ 
          text: chunks[i], 
          voiceName: voiceOption?.id.startsWith('custom') ? VoiceName.ZEPHYR : (voiceOption?.id as VoiceName), 
          pitch,
          referenceProfile: voiceOption?.isCloned ? voiceOption.description : undefined
        });
        audioBuffers.push(result.audioBuffer);
      }

      setLoadingMessage('Merging audio...');
      const finalBuffer = await ttsService.concatenateAudioBuffers(audioBuffers);
      
      const channelData = finalBuffer.getChannelData(0);
      const int16Data = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        int16Data[i] = Math.max(-1, Math.min(1, channelData[i])) * 32767;
      }
      const finalBlob = createWavBlob(new Uint8Array(int16Data.buffer), 24000);

      const runResult: TTSRunResult = {
        audioBuffer: finalBuffer,
        blob: finalBlob,
        base64: ''
      };

      setLastResult(runResult);
      setIsPlaying(true);
      setHistory(prev => [{ id: crypto.randomUUID(), text, voiceName: voiceOption?.name || 'Unknown', timestamp: Date.now(), audioBuffer: finalBuffer, blob: finalBlob }, ...prev]);
      await ttsService.play(finalBuffer, () => setIsPlaying(false));
    } catch (err: any) {
      setError(err.message || 'Synthesis failed.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [text, selectedVoice, pitch, clonedVoices]);

  const isOverLimit = text.length > MAX_CHARS;

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center max-w-7xl mx-auto">
      <header className="w-full mb-10 text-center">
        <h1 className="text-5xl font-extrabold mb-3 gradient-text tracking-tight">DANH VOICE PRO</h1>
        <div className="flex items-center justify-center gap-2 text-gray-400 text-lg font-light">
          <span>S1-mini Inspired Speech Engine</span>
          <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/20">v2.5 Full-Range Control</span>
        </div>
      </header>

      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-8 flex flex-col gap-6">
          <div className="glass p-6 rounded-3xl relative min-h-[500px] flex flex-col border border-white/5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                Dynamic Script Editor
                {isChecking && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>}
              </label>
              <div className="flex gap-4">
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".txt,.md,.docx" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} className="text-xs text-gray-400 hover:text-white transition-colors font-bold">UPLOAD</button>
                <button onClick={handleCheckSpelling} disabled={isChecking || !text.trim()} className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-bold disabled:opacity-30">AUTO-FIX</button>
                <button onClick={() => setText('')} className="text-xs text-gray-500 hover:text-white transition-colors">CLEAR</button>
              </div>
            </div>
            
            <textarea
              ref={textAreaRef}
              className="w-full bg-transparent border-none p-0 flex-1 min-h-[300px] focus:ring-0 outline-none text-xl leading-relaxed placeholder:text-white/5 resize-none custom-scrollbar"
              placeholder="Start typing your script... Use markers like (furious) to change tone or (laughing) for effects."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <div className="mt-6">
              <div className="flex items-center justify-between border-b border-white/5 mb-4 pr-2">
                <div className="flex gap-4">
                  {(['emotions', 'tones', 'effects'] as const).map(tab => (
                    <button 
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`pb-2 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-600 hover:text-gray-400'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {activeTab === 'effects' && (
                  <div className="flex items-center gap-2 bg-white/5 px-2 py-1 rounded-lg mb-2">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-tighter">Intensity:</span>
                    {INTENSITIES.map(level => (
                      <button 
                        key={level} 
                        onClick={() => setSelectedIntensity(level)}
                        className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase transition-all ${selectedIntensity === level ? 'bg-purple-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto custom-scrollbar pr-2">
                {activeTab === 'emotions' && EMOTIONS.map(e => (
                  <button key={e} onClick={() => insertMarker(e)} className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-white/5 text-gray-400 hover:bg-purple-500/20 hover:text-purple-300 transition-all border border-white/5">
                    {e}
                  </button>
                ))}
                {activeTab === 'tones' && TONES.map(t => (
                  <button key={t} onClick={() => insertMarker(t)} className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/10">
                    {t}
                  </button>
                ))}
                {activeTab === 'effects' && (
                  <>
                    <div className="w-full mb-1 flex items-center gap-2">
                      <div className="h-px flex-1 bg-white/5"></div>
                      <span className="text-[8px] font-black text-gray-700 uppercase tracking-widest">Processing Effects</span>
                      <div className="h-px flex-1 bg-white/5"></div>
                    </div>
                    {PROCESSING_EFFECTS.map(fx => (
                      <button key={fx.id} onClick={() => insertMarker(fx.id, selectedIntensity)} className="px-3 py-1.5 rounded-xl text-[10px] font-black bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-all border border-indigo-500/10 shadow-sm shadow-indigo-900/10">
                        {fx.label} ({selectedIntensity})
                      </button>
                    ))}
                    <div className="w-full mt-2 mb-1 flex items-center gap-2">
                      <div className="h-px flex-1 bg-white/5"></div>
                      <span className="text-[8px] font-black text-gray-700 uppercase tracking-widest">Physical & Ambience</span>
                      <div className="h-px flex-1 bg-white/5"></div>
                    </div>
                    {EFFECTS.map(fx => (
                      <button key={fx} onClick={() => insertMarker(fx)} className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-all border border-pink-500/10">
                        {fx}
                      </button>
                    ))}
                  </>
                )}
              </div>
              
              <div className="flex items-center justify-end mt-4">
                <div className={`text-[10px] font-bold tracking-widest ${isOverLimit ? 'text-red-500 animate-pulse' : 'text-gray-600'}`}>
                  {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="glass p-6 rounded-3xl flex-1 overflow-hidden flex flex-col max-h-[300px]">
            <h3 className="text-xs font-black text-gray-600 uppercase mb-4 tracking-widest">Recent Activity</h3>
            <div className="space-y-3 overflow-y-auto custom-scrollbar flex-1">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-700 italic text-xs py-10">No recent generations.</div>
              ) : (
                history.map(item => (
                  <div key={item.id} className="flex items-center gap-4 bg-white/[0.02] p-3 rounded-2xl border border-white/5 hover:bg-white/[0.04] transition-all group">
                     <div className="flex-1 min-w-0">
                       <p className="text-sm truncate text-gray-300">"{item.text}"</p>
                       <p className="text-[9px] text-gray-600 font-bold uppercase mt-1">{item.voiceName} • {new Date(item.timestamp).toLocaleTimeString()}</p>
                     </div>
                     <button onClick={() => ttsService.play(item.audioBuffer)} className="p-2 rounded-full hover:bg-purple-500/20 text-purple-400 transition-colors">
                       <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168l4.2 2.8a1 1 0 010 1.664l-4.2 2.8A1 1 0 018 13.56V7.44a1 1 0 011.555-.832z"/></svg>
                     </button>
                  </div>
                )
              ))}
            </div>
          </div>
        </section>

        <aside className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass p-6 rounded-3xl border-purple-500/20">
            <h3 className="text-xs font-black text-gray-600 uppercase mb-4 tracking-widest flex justify-between items-center">
              Voice Architecture
              {isRecording && <span className="flex h-2 w-2 rounded-full bg-red-500 animate-ping"></span>}
            </h3>
            <div className="flex flex-col gap-2">
              {isRecording ? (
                <button onClick={handleStopRecording} className="w-full py-4 rounded-2xl bg-red-600 hover:bg-red-500 font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-900/20">
                  <div className="w-3 h-3 bg-white rounded-sm animate-pulse"></div> STOP RECORDING
                </button>
              ) : (
                <>
                  <button onClick={handleStartRecording} className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 hover:border-purple-500 text-gray-400 hover:text-purple-400 font-bold flex items-center justify-center gap-2 transition-all group">
                    <svg className="w-4 h-4 text-purple-500 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-20a3 3 0 00-3 3v1a3 3 0 006 0V4a3 3 0 00-3-3z"/></svg>
                    RECORD VOICE
                  </button>
                  <div className="relative">
                    <input type="file" ref={audioFileInputRef} onChange={handleAudioFileUpload} accept="audio/*" className="hidden" />
                    <button onClick={() => audioFileInputRef.current?.click()} className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 hover:border-blue-500 text-gray-400 hover:text-blue-400 font-bold flex items-center justify-center gap-2 transition-all group">
                      <svg className="w-4 h-4 text-blue-500 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12"/></svg>
                      UPLOAD SAMPLE
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="glass p-6 rounded-3xl">
            <h3 className="text-xs font-black text-gray-600 uppercase mb-4 tracking-widest">Base Models</h3>
            <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar pr-2">
              {[...VOICE_OPTIONS, ...clonedVoices].map((voice) => (
                <div 
                  key={voice.id}
                  onClick={() => setSelectedVoice(voice.id)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 group relative ${selectedVoice === voice.id ? 'bg-purple-600/20 border-purple-500' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${voice.gender === 'Custom' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-500 group-hover:bg-gray-400'}`}>
                    {voice.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold flex items-center gap-2 text-gray-300">
                      {voice.name}
                      {voice.isCloned && <span className="text-[7px] px-1 bg-orange-600 rounded text-white font-black uppercase tracking-tighter shrink-0">Clone</span>}
                    </div>
                    <div className="text-[9px] text-gray-600 truncate leading-tight mt-0.5">{voice.description}</div>
                  </div>
                  
                  <button 
                    onClick={(e) => handlePreviewVoice(voice, e)}
                    className={`p-2 rounded-lg transition-all shrink-0 ${previewingId === voice.id ? 'bg-purple-500 text-white shadow-lg' : 'bg-white/5 hover:bg-white/20 text-gray-500 hover:text-white'}`}
                  >
                    {previewingId === voice.id ? (
                      <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="glass p-6 rounded-3xl flex flex-col gap-4">
            {error && <div className="text-xs text-red-500 text-center bg-red-950/20 py-2 rounded-xl border border-red-500/10">{error}</div>}
            
            <button
              onClick={handleSynthesize}
              disabled={isLoading || isRecording || !text.trim() || isOverLimit}
              className="w-full py-5 rounded-2xl font-black text-lg bg-gradient-to-br from-purple-600 to-pink-600 hover:brightness-110 hover:scale-[1.02] disabled:grayscale disabled:scale-100 transition-all shadow-xl shadow-purple-900/20 text-white flex items-center justify-center gap-3 relative overflow-hidden"
            >
              {isLoading ? (
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    <span>SYNCING ENGINE...</span>
                  </div>
                  <span className="text-[9px] font-bold text-white/50 tracking-tighter uppercase">{loadingMessage}</span>
                </div>
              ) : isOverLimit ? 'CAPACITY EXCEEDED' : 'GENERATE MASTER AUDIO'}
            </button>
            
            {lastResult && (
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => ttsService.play(lastResult.audioBuffer)}
                  className="py-3 border border-white/5 rounded-xl text-[10px] font-black text-gray-500 hover:text-white hover:bg-white/5 flex items-center justify-center gap-2 transition-colors uppercase"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168l4.2 2.8a1 1 0 010 1.664l-4.2 2.8A1 1 0 018 13.56V7.44a1 1 0 011.555-.832z"/></svg>
                  REPLAY
                </button>
                <button 
                  onClick={() => {
                     const a = document.createElement('a');
                     a.href = URL.createObjectURL(lastResult.blob);
                     a.download = `DANH_PRO_${Date.now()}.wav`;
                     a.click();
                  }}
                  className="py-3 border border-white/5 rounded-xl text-[10px] font-black text-gray-500 hover:text-white hover:bg-white/5 flex items-center justify-center gap-2 transition-colors uppercase"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  DOWNLOAD
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="mt-16 py-8 text-center text-gray-700 text-[9px] border-t border-white/5 w-full uppercase tracking-[0.2em] font-black">
        <p>DANH VOICE PRO V2.5 • AI AUDIO SYNTHESIS ENGINE • POWERED BY GEMINI 2.5 FLASH</p>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>
    </div>
  );
};

export default App;
