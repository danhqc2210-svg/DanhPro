import { GoogleGenerativeAI } from "@google/generative-ai";
import { TTSConfig, VoiceName, Language } from "../types";
import { decode, decodeAudioData, createWavBlob } from "../utils/audioHelper";

export interface TTSRunResult {
  audioBuffer: AudioBuffer;
  blob: Blob;
  base64: string;
}

export class TTSService {
  private ai: any; 
  private audioContext: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private playbackState: 'playing' | 'paused' | 'stopped' = 'stopped';

  constructor() {
    // SỬA: Dùng import.meta.env cho Vite và khớp với biến Vercel
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
    const genAI = new GoogleGenerativeAI(apiKey);
    // Sử dụng model 2.0 Flash ổn định để tránh lỗi 429
    this.ai = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  getAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
    }
    return this.audioContext;
  }

  private getPitchDescription(pitch: number): string {
    if (pitch <= 0.7) return "very low pitch";
    if (pitch <= 0.9) return "low pitch";
    if (pitch >= 1.3) return "very high pitch";
    if (pitch >= 1.1) return "high pitch";
    return "natural pitch";
  }

  async analyzeVoice(audioBase64: string): Promise<string> {
    const prompt = "Phân tích đặc điểm giọng nói: giới tính, tuổi, sắc thái, cảm xúc. Trả về 1 đoạn mô tả ngắn bằng tiếng Anh.";
    try {
      const result = await this.ai.generateContent([
        { text: prompt },
        { inlineData: { mimeType: "audio/wav", data: audioBase64 } }
      ]);
      return result.response.text() || "Professional voice.";
    } catch (error) {
      console.error("Lỗi phân tích:", error);
      throw new Error("Lỗi mẫu giọng.");
    }
  }

  async checkSpelling(text: string): Promise<string> {
    const prompt = `Sửa lỗi chính tả văn bản sau. Chỉ trả về kết quả:\n${text}`;
    try {
      const result = await this.ai.generateContent(prompt);
      return result.response.text() || text;
    } catch (error) {
      return text;
    }
  }

  async synthesize(config: TTSConfig): Promise<TTSRunResult> {
    const ctx = this.getAudioContext();
    const pitchDesc = this.getPitchDescription(config.pitch);
    const langNote = config.language !== Language.AUTO ? `NGÔN NGỮ: ${config.language}.` : '';
    
    const promptText = `HÀNH ĐỘNG: Diễn viên lồng tiếng. CẤU HÌNH: ${pitchDesc}, tốc độ ${config.speed}x, ${langNote}.
KỊCH BẢN: ${config.text}`;

    try {
      // SỬA LỖI: Cấu trúc generationConfig chuẩn cho Audio của Gemini 2.0
      const result = await this.ai.generateContent({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: {
          responseModalities: ["audio"], // Sử dụng chuỗi "audio" thay vì Modality.AUDIO
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { 
                voiceName: config.voiceName.includes('custom') ? "Aoede" : config.voiceName 
              }
            }
          }
        }
      });

      const audioPart = result.response.candidates[0].content.parts.find((p: any) => p.inlineData);
      const base64Audio = audioPart?.inlineData?.data;

      if (!base64Audio) throw new Error("API error: No audio data");

      const pcmBytes = decode(base64Audio);
      const audioBuffer = await decodeAudioData(pcmBytes, ctx, 24000, 1);
      const blob = createWavBlob(pcmBytes, 24000);

      return { audioBuffer, blob, base64: base64Audio };
    } catch (error: any) {
      console.error("TTS Error:", error);
      throw error;
    }
  }

  async play(audioBuffer: AudioBuffer, onEnded?: () => void): Promise<void> {
    this.stop(); 
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => { if (this.activeSource === source) { this.activeSource = null; this.playbackState = 'stopped'; onEnded?.(); } };
    this.activeSource = source;
    this.playbackState = 'playing';
    source.start();
  }

  stop() { if (this.activeSource) { try { this.activeSource.stop(); } catch (e) {} this.activeSource = null; } this.playbackState = 'stopped'; }
}

export const ttsService = new TTSService();
