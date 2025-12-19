
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceName, VoiceOption, HistoryItem, TTSConfig, Language } from './types';
import { ttsService, TTSRunResult } from './services/geminiTTS';
import { encode, createWavBlob } from './utils/audioHelper';
import mammoth from 'mammoth';

const MAX_CHARS = 50000;
const CHUNK_SIZE = 4500; 

const VOICE_OPTIONS: VoiceOption[] = [
  { id: VoiceName.ZEPHYR, name: 'Zephyr', description: 'Ấm áp & Chuyên nghiệp', gender: 'Male' },
  { id: VoiceName.PUCK, name: 'Puck', description: 'Năng động & Trẻ trung', gender: 'Male' },
  { id: VoiceName.KORE, name: 'Kore', description: 'Điềm tĩnh & Vững chãi', gender: 'Female' },
  { id: VoiceName.AOEDE, name: 'Aoede', description: 'Duy mỹ & Truyền cảm', gender: 'Female' },
  { id: VoiceName.CHARON, name: 'Charon', description: 'Trầm ấm & Quyền lực', gender: 'Male' },
  { id: VoiceName.FENRIR, name: 'Fenrir', description: 'Góc cạnh & Mạnh mẽ', gender: 'Male' },
];

const LANGUAGES = [
  { label: 'Tự động', value: Language.AUTO },
  { label: 'Tiếng Việt', value: Language.VIETNAMESE },
  { label: 'Tiếng Nhật', value: Language.JAPANESE },
  { label: 'Tiếng Anh', value: Language.ENGLISH },
];

const EMOTIONS = [
  { label: "Khinh bỉ", tag: "disdainful" },
  { label: "Buồn bã", tag: "unhappy" },
  { label: "Lo âu", tag: "anxious" },
  { label: "Giận dữ", tag: "furious" },
  { label: "Kinh ngạc", tag: "astonished" },
  { label: "Mỉa mai", tag: "sarcastic" },
  { label: "An ủi", tag: "comforting" },
  { label: "Vui vẻ", tag: "amused" }
];

const TONES = [
  { label: "Vội vã", tag: "in a hurry tone" },
  { label: "Hét lớn", tag: "shouting" },
  { label: "Thì thầm", tag: "whispering" },
  { label: "Nhẹ nhàng", tag: "soft tone" }
];

const EFFECTS = [
  { label: "Cười lớn", tag: "laughing" },
  { label: "Cười thầm", tag: "chuckling" },
  { label: "Khóc", tag: "sobbing" },
  { label: "Thở dài", tag: "sighing" }
];

const PROCESSING_EFFECTS = [
  { id: "reverb", label: "Vang" },
  { id: "echo", label: "Vọng" }
];

const INTENSITIES = ["Thấp", "Vừa", "Cao"];

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>(VoiceName.ZEPHYR);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(Language.AUTO);
  const [clonedVoices, setClonedVoices] = useState<VoiceOption[]>([]);
  const [pitch, setPitch] = useState(1.0);
  const [speed, setSpeed] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [playbackState, setPlaybackState] = useState<'playing' | 'paused' | 'stopped'>('stopped');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [markerPreviewingId, setMarkerPreviewingId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TTSRunResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'emotions' | 'tones' | 'effects'>('emotions');
  const [selectedIntensity, setSelectedIntensity] = useState<string>("Vừa");
  
  const isOverLimit = text.length > MAX_CHARS;
  const abortControllerRef = useRef<boolean>(false);
  
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setPlaybackState(ttsService.getPlaybackState()), 200);
    return () => clearInterval(interval);
  }, []);

  const insertMarker = (tag: string, intensity?: string) => {
    const intMap: Record<string, string> = { "Thấp": "low", "Vừa": "medium", "Cao": "high" };
    const formattedTag = intensity ? `(${tag}: ${intMap[intensity]})` : `(${tag})`;
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

  const previewMarker = async (tag: string, intensity?: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (markerPreviewingId === tag) { ttsService.stop(); setMarkerPreviewingId(null); return; }
    setMarkerPreviewingId(tag);
    try {
      const intMap: Record<string, string> = { "Thấp": "low", "Vừa": "medium", "Cao": "high" };
      const formattedTag = intensity ? `(${tag}: ${intMap[intensity]})` : `(${tag})`;
      const result = await ttsService.synthesize({
        text: `Đang thử hiệu ứng ${tag}. ${formattedTag} Nghe rất tốt.`,
        voiceName: selectedVoice.startsWith('custom') ? VoiceName.ZEPHYR : (selectedVoice as VoiceName),
        language: selectedLanguage,
        pitch: 1.0,
        speed: 1.0,
        referenceProfile: clonedVoices.find(v => v.id === selectedVoice)?.description
      });
      await ttsService.play(result.audioBuffer, () => setMarkerPreviewingId(null));
    } catch { setMarkerPreviewingId(null); }
  };

  const handleStopGeneration = () => {
    abortControllerRef.current = true;
    setIsLoading(false);
    setLoadingMessage('Đã hủy quá trình tạo.');
    setProgress(0);
  };

  const handleSynthesize = useCallback(async () => {
    if (!text.trim() || text.length > MAX_CHARS) return;
    setIsLoading(true);
    setError(null);
    setProgress(0);
    abortControllerRef.current = false;
    
    try {
      const voiceOption = [...VOICE_OPTIONS, ...clonedVoices].find(v => v.id === selectedVoice);
      
      // Chia nhỏ văn bản thành các phân đoạn
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= CHUNK_SIZE) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n', CHUNK_SIZE);
        if (splitAt === -1 || splitAt < CHUNK_SIZE * 0.5) splitAt = remaining.lastIndexOf('. ', CHUNK_SIZE);
        if (splitAt === -1) splitAt = CHUNK_SIZE;
        chunks.push(remaining.substring(0, splitAt + 1));
        remaining = remaining.substring(splitAt + 1);
      }
      
      const audioBuffers: AudioBuffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (abortControllerRef.current) {
          throw new Error("Quá trình tạo đã bị dừng bởi người dùng.");
        }
        
        const currentProgress = Math.round((i / chunks.length) * 100);
        setProgress(currentProgress);
        setLoadingMessage(`Đang xử lý phân đoạn ${i + 1}/${chunks.length}...`);
        
        const result = await ttsService.synthesize({ 
          text: chunks[i], 
          language: selectedLanguage,
          voiceName: voiceOption?.id.startsWith('custom') ? VoiceName.ZEPHYR : (voiceOption?.id as VoiceName), 
          pitch,
          speed,
          referenceProfile: voiceOption?.isCloned ? voiceOption.description : undefined
        });
        audioBuffers.push(result.audioBuffer);
      }
      
      if (abortControllerRef.current) return;
      
      setProgress(100);
      setLoadingMessage('Đang đồng bộ dữ liệu...');
      const finalBuffer = audioBuffers.length > 1 ? await ttsService.concatenateAudioBuffers(audioBuffers) : audioBuffers[0];
      
      const channelData = finalBuffer.getChannelData(0);
      const int16Data = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) int16Data[i] = Math.max(-1, Math.min(1, channelData[i])) * 32767;
      const finalBlob = createWavBlob(new Uint8Array(int16Data.buffer), 24000);
      
      const runResult = { audioBuffer: finalBuffer, blob: finalBlob, base64: '' };
      setLastResult(runResult);
      setHistory(prev => [{ 
        id: crypto.randomUUID(), 
        text: text.slice(0, 60) + (text.length > 60 ? '...' : ''), 
        voiceName: voiceOption?.name || 'Vô danh', 
        timestamp: Date.now(), 
        audioBuffer: finalBuffer, 
        blob: finalBlob 
      }, ...prev]);
      
      await ttsService.play(finalBuffer);
    } catch (err: any) { 
      if (err.message !== "Quá trình tạo đã bị dừng bởi người dùng.") {
        setError("Lỗi hệ thống. Vui lòng thử lại."); 
      }
    } finally { 
      setIsLoading(false); 
      setLoadingMessage(''); 
      setProgress(0);
    }
  }, [text, selectedVoice, selectedLanguage, pitch, speed, clonedVoices]);

  // Fix: Explicitly add key property to props type to satisfy TypeScript requirements in list rendering
  const MarkerButton = ({ label, tag, type, intensity }: { label: string; tag: string; type: 'emotions' | 'tones' | 'effects'; intensity?: string; key?: React.Key }) => (
    <div className={`flex items-center rounded-xl overflow-hidden border transition-all ${
      type === 'emotions' ? 'bg-white/5 border-white/5 text-gray-400 hover:border-purple-500/50' :
      type === 'tones' ? 'bg-blue-500/10 border-blue-500/10 text-blue-400 hover:border-blue-400/50' :
      'bg-pink-500/10 border-pink-500/10 text-pink-400 hover:border-pink-400/50'
    }`}>
      <button onClick={(e) => previewMarker(tag, intensity, e)} className="px-2 py-1.5 border-r border-white/5 hover:bg-white/10">
        {markerPreviewingId === tag ? <div className="w-3 h-3 border-2 border-t-white rounded-full animate-spin"></div> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>}
      </button>
      <button onClick={() => insertMarker(tag, intensity)} className="px-3 py-1.5 text-[10px] font-bold flex-1 text-left hover:bg-white/5 uppercase">{label}</button>
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center max-w-7xl mx-auto">
      <header className="w-full mb-10 text-center">
        <h1 className="text-5xl font-extrabold mb-3 gradient-text tracking-tight">DANH VOICE PRO</h1>
        <div className="flex items-center justify-center gap-2 text-gray-400 text-lg font-light">
          <span>Hệ thống AI Speech tối ưu Tiếng Việt & Tiếng Nhật</span>
          <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/20 uppercase">v2.8 Master Edition</span>
        </div>
      </header>

      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-8 flex flex-col gap-6">
          <div className="glass p-6 rounded-3xl relative min-h-[500px] flex flex-col border border-white/5 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">KỊCH BẢN ÂM THANH</label>
              <div className="flex gap-4">
                <button onClick={() => fileInputRef.current?.click()} className="text-xs text-gray-400 hover:text-white font-bold uppercase">MỞ FILE</button>
                <button onClick={() => { setIsChecking(true); ttsService.checkSpelling(text).then(t => { setText(t); setIsChecking(false); }); }} disabled={isChecking || !text.trim()} className="text-xs text-blue-400 hover:text-blue-300 font-bold uppercase disabled:opacity-30">TỐI ƯU VĂN BẢN</button>
                <button onClick={() => setText('')} className="text-xs text-gray-500 hover:text-white uppercase">XÓA</button>
                <input type="file" ref={fileInputRef} onChange={(e) => {
                   const file = e.target.files?.[0]; if (file) {
                     if (file.name.endsWith('.docx')) mammoth.extractRawText({ arrayBuffer: e.target.files![0].slice().arrayBuffer() as any }).then(r => setText(r.value));
                     else file.text().then(t => setText(t.slice(0, MAX_CHARS)));
                   }
                }} accept=".txt,.md,.docx" className="hidden" />
              </div>
            </div>
            
            <textarea
              ref={textAreaRef}
              className="w-full bg-transparent border-none p-0 flex-1 min-h-[300px] focus:ring-0 outline-none text-xl leading-relaxed placeholder:text-white/5 resize-none custom-scrollbar"
              placeholder="Nhập nội dung... Sử dụng (marker) để tạo cảm xúc hoặc hiệu ứng âm thanh."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isLoading}
            />

            <div className="mt-6">
              <div className="flex items-center justify-between border-b border-white/5 mb-4 pr-2">
                <div className="flex gap-4">
                  {(['emotions', 'tones', 'effects'] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-600 hover:text-gray-400'}`}>
                      {tab === 'emotions' ? 'Cảm xúc' : tab === 'tones' ? 'Tông giọng' : 'Hiệu ứng'}
                    </button>
                  ))}
                </div>
                {activeTab === 'effects' && (
                  <div className="flex items-center gap-2 bg-white/5 px-2 py-1 rounded-lg mb-2">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-tighter">Mức độ:</span>
                    {INTENSITIES.map(level => (
                      <button key={level} onClick={() => setSelectedIntensity(level)} className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${selectedIntensity === level ? 'bg-purple-500 text-white' : 'text-gray-500'}`}>{level}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto custom-scrollbar pr-2">
                {activeTab === 'emotions' && EMOTIONS.map(e => <MarkerButton key={e.tag} label={e.label} tag={e.tag} type="emotions" />)}
                {activeTab === 'tones' && TONES.map(t => <MarkerButton key={t.tag} label={t.label} tag={t.tag} type="tones" />)}
                {activeTab === 'effects' && (
                  <>
                    {PROCESSING_EFFECTS.map(fx => <MarkerButton key={fx.id} label={`${fx.label} (${selectedIntensity})`} tag={fx.id} type="effects" intensity={selectedIntensity} />)}
                    {EFFECTS.map(fx => <MarkerButton key={fx.tag} label={fx.label} tag={fx.tag} type="effects" />)}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="glass p-6 rounded-3xl flex-1 flex flex-col min-h-[400px]">
            <h3 className="text-xs font-black text-gray-600 uppercase mb-6 tracking-widest flex items-center justify-between">
              LỊCH SỬ GIỌNG ĐỌC ĐÃ TẠO
              <span className="text-[10px] text-gray-400 normal-case font-normal">{history.length} bản ghi</span>
            </h3>
            <div className="space-y-4 overflow-y-auto custom-scrollbar flex-1 pr-2">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
                  <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <p className="text-xs font-bold uppercase tracking-widest">Chưa có lịch sử</p>
                </div>
              ) : (
                history.map(item => (
                  <div key={item.id} className="group flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-purple-500/30 transition-all">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate font-medium">"{item.text}"</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] font-black text-purple-400 uppercase tracking-tighter bg-purple-500/10 px-1.5 py-0.5 rounded">{item.voiceName}</span>
                        <span className="text-[9px] text-gray-600 font-bold uppercase tracking-tighter">{new Date(item.timestamp).toLocaleTimeString()} • {new Date(item.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => ttsService.play(item.audioBuffer)}
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-purple-500 hover:text-white transition-all"
                        title="Nghe lại"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168l4.2 2.8a1 1 0 010 1.664l-4.2 2.8A1 1 0 018 13.56V7.44a1 1 0 011.555-.832z"/></svg>
                      </button>
                      <button 
                        onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(item.blob); a.download = `DANH_VOICE_${Date.now()}.wav`; a.click(); }}
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-blue-500 hover:text-white transition-all"
                        title="Tải về"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12"/></svg>
                      </button>
                      <button 
                        onClick={() => setHistory(h => h.filter(i => i.id !== item.id))}
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-red-500 hover:text-white transition-all"
                        title="Xóa"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <aside className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass p-6 rounded-3xl border-purple-500/20">
            <h3 className="text-xs font-black text-gray-600 uppercase mb-4 tracking-widest">CẤU HÌNH NGÔN NGỮ</h3>
            <div className="flex flex-wrap gap-2 mb-6">
              {LANGUAGES.map(lang => (
                <button 
                  key={lang.value} 
                  onClick={() => setSelectedLanguage(lang.value)}
                  className={`px-3 py-2 rounded-xl text-[10px] font-bold border transition-all ${selectedLanguage === lang.value ? 'bg-purple-600/20 border-purple-500 text-purple-400' : 'bg-white/5 border-transparent text-gray-500'}`}
                >
                  {lang.label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
               <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black text-gray-500 uppercase">Tốc độ (Speed)</span>
                    <span className="text-[10px] font-black text-purple-400">{speed.toFixed(1)}x</span>
                  </div>
                  <input type="range" min="0.5" max="2.0" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="w-full accent-purple-500 h-1 bg-white/5 rounded-lg appearance-none cursor-pointer" />
               </div>
               <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black text-gray-500 uppercase">Độ cao (Pitch)</span>
                    <span className="text-[10px] font-black text-blue-400">{pitch.toFixed(1)}v</span>
                  </div>
                  <input type="range" min="0.5" max="1.5" step="0.1" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-white/5 rounded-lg appearance-none cursor-pointer" />
               </div>
            </div>
          </div>

          <div className="glass p-6 rounded-3xl">
            <h3 className="text-xs font-black text-gray-600 uppercase mb-4 tracking-widest flex justify-between">
              GIỌNG NÓI MẪU
              <button onClick={() => audioFileInputRef.current?.click()} className="text-[9px] text-purple-400 hover:underline">CLONE +</button>
            </h3>
            <input type="file" ref={audioFileInputRef} onChange={(e) => {
               const file = e.target.files?.[0]; if (file) {
                 setIsLoading(true); setLoadingMessage('Đang clone giọng...');
                 file.arrayBuffer().then(b => ttsService.analyzeVoice(encode(new Uint8Array(b))).then(p => {
                    setClonedVoices(v => [...v, { id: `custom-${Date.now()}`, name: `Clone ${v.length+1}`, description: p, gender: 'Custom', isCloned: true }]);
                    setIsLoading(false);
                 }));
               }
            }} className="hidden" />
            
            <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-2">
              {[...VOICE_OPTIONS, ...clonedVoices].map((voice) => (
                <div key={voice.id} onClick={() => setSelectedVoice(voice.id)} className={`p-3 rounded-2xl border cursor-pointer flex items-center gap-3 ${selectedVoice === voice.id ? 'bg-purple-600/20 border-purple-500' : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${voice.gender === 'Custom' ? 'bg-orange-500' : 'bg-gray-800 text-gray-500'}`}>{voice.name[0]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-gray-300 truncate">{voice.name}</div>
                    <div className="text-[8px] text-gray-600 truncate">{voice.description}</div>
                  </div>
                  <button onClick={(e) => {
                     e.stopPropagation(); setPreviewingId(voice.id);
                     ttsService.synthesize({ text: "Thử giọng mẫu.", language: selectedLanguage, voiceName: voice.isCloned ? VoiceName.ZEPHYR : voice.id as VoiceName, pitch: 1.0, speed: 1.0, referenceProfile: voice.isCloned ? voice.description : undefined })
                        .then(r => ttsService.play(r.audioBuffer, () => setPreviewingId(null)));
                  }} className="p-1.5 bg-white/5 rounded-lg group-hover:bg-white/10">
                    {previewingId === voice.id ? <div className="w-3 h-3 border-2 border-t-white rounded-full animate-spin"></div> : <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="glass p-6 rounded-3xl flex flex-col gap-4">
            {error && <div className="text-[10px] text-red-500 text-center bg-red-900/10 py-2 rounded-xl">{error}</div>}
            
            {isLoading ? (
              <div className="flex flex-col gap-3">
                <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-600 to-pink-600 transition-all duration-300 shadow-[0_0_10px_rgba(168,85,247,0.5)]" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-t-white rounded-full animate-spin"></div>
                    <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">{loadingMessage}</span>
                  </div>
                  <span className="text-sm font-black text-purple-400">{progress}%</span>
                </div>
                <button
                  onClick={handleStopGeneration}
                  className="w-full py-4 rounded-2xl font-black text-xs bg-red-600/20 text-red-400 border border-red-600/20 hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest"
                >
                  DỪNG TẠO / HỦY BỎ
                </button>
              </div>
            ) : (
              <button
                onClick={handleSynthesize}
                disabled={!text.trim() || isOverLimit}
                className="w-full py-6 rounded-2xl font-black text-lg bg-gradient-to-br from-purple-600 to-pink-600 hover:brightness-110 disabled:grayscale transition-all shadow-[0_10px_40px_rgba(168,85,247,0.3)] text-white flex items-center justify-center gap-3 active:scale-[0.98]"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168l4.2 2.8a1 1 0 010 1.664l-4.2 2.8A1 1 0 018 13.56V7.44a1 1 0 011.555-.832z" clipRule="evenodd"/></svg>
                XUẤT ÂM THANH MASTER
              </button>
            )}
            
            {lastResult && !isLoading && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => playbackState === 'playing' ? ttsService.pause() : ttsService.resume()} className="py-4 border border-white/5 bg-white/5 rounded-2xl text-[10px] font-black text-gray-300 hover:text-white hover:bg-white/10 uppercase tracking-widest transition-all">
                  {playbackState === 'playing' ? 'TẠM DỪNG' : 'TIẾP TỤC NGHE'}
                </button>
                <button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(lastResult!.blob); a.download = `DANH_PRO_${Date.now()}.wav`; a.click(); }} className="py-4 border border-white/5 bg-white/5 rounded-2xl text-[10px] font-black text-gray-300 hover:text-white hover:bg-white/10 uppercase tracking-widest transition-all">
                  TẢI VỀ (.WAV)
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="mt-16 py-8 text-center text-gray-700 text-[9px] border-t border-white/5 w-full uppercase tracking-[0.2em] font-black">
        DANH VOICE PRO V2.8 • SEMANTIC INFLECTION • POWERED BY GEMINI 2.5 FLASH
      </footer>
    </div>
  );
};

export default App;
