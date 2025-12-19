import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, VoiceName, Language } from "../types";
import { decode, decodeAudioData, createWavBlob } from "../utils/audioHelper";

export interface TTSRunResult {
  audioBuffer: AudioBuffer;
  blob: Blob;
  base64: string;
}

export class TTSService {
  private ai: GoogleGenAI;
  private audioContext: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private playbackState: 'playing' | 'paused' | 'stopped' = 'stopped';

  constructor() {
    // SỬA: Sử dụng import.meta.env cho Vite và khớp với biến Vercel
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
    this.ai = new GoogleGenAI({ apiKey });
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
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash", // Đã chuẩn hóa
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "audio/wav", data: audioBase64 } }] }],
      });
      return response.text || "Professional voice.";
    } catch (error) {
      console.error("Lỗi phân tích:", error);
      throw new Error("Lỗi mẫu giọng.");
    }
  }

  async checkSpelling(text: string): Promise<string> {
    const prompt = `Sửa lỗi chính tả văn bản sau. Giữ nguyên (marker). Chỉ trả về kết quả:\n${text}`;
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash", // Đã chuẩn hóa
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text || text;
    } catch (error) {
      return text;
    }
  }

  async concatenateAudioBuffers(buffers: AudioBuffer[]): Promise<AudioBuffer> {
    const ctx = this.getAudioContext();
    const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
    const result = ctx.createBuffer(buffers[0].numberOfChannels, totalLength, buffers[0].sampleRate);
    let offset = 0;
    for (const buffer of buffers) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        result.getChannelData(channel).set(buffer.getChannelData(channel), offset);
      }
      offset += buffer.length;
    }
    return result;
  }

  async synthesize(config: TTSConfig): Promise<TTSRunResult> {
    const ctx = this.getAudioContext();
    const pitchDesc = this.getPitchDescription(config.pitch);
    const langNote = config.language !== Language.AUTO ? `NGÔN NGỮ BẮT BUỘC: ${config.language}. Đọc đúng accent của ngôn ngữ này.` : 'Tự động nhận diện ngôn ngữ.';
    
    const promptText = `HÀNH ĐỘNG: Diễn viên lồng tiếng chuyên nghiệp.
CẤU HÌNH: ${pitchDesc}, tốc độ ${config.speed}x, ${langNote}.
${config.referenceProfile ? `PHONG CÁCH GIỌNG: ${config.referenceProfile}` : ''}

QUY TẮC NHẤN NHÁ THEO NGỮ CẢNH:
1. HIỂU CÂU CHUYỆN: Phân tích nội dung để ngắt nghỉ truyền cảm.
2. TIẾNG NHẬT: Tuân thủ Pitch Accent, Mora. Chú ý Kanji có nhiều cách đọc, chọn cách đọc phù hợp ngữ cảnh câu chuyện.
3. TIẾNG VIỆT: Đọc rõ dấu thanh, nhấn mạnh từ biểu cảm.
4. MARKER: Thực hiện cảm xúc trong () mà không đọc từ đó.

KỊCH BẢN:
${config.text}`;

    try {
      const response = await this.ai.models.generateContent({
        // QUAN TRỌNG: Đã đổi sang gemini-2.0-flash để tránh giới hạn 10 lượt/ngày
        model: "gemini-2.0-flash", 
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { 
                voiceName: config.voiceName.includes('custom') ? VoiceName.ZEPHYR : config.voiceName as VoiceName 
              },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("API error");

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

  async pause() { const ctx = this.getAudioContext(); if (ctx.state === 'running') { await ctx.suspend(); this.playbackState = 'paused'; } }
  async resume() { const ctx = this.getAudioContext(); if (ctx.state === 'suspended') { await ctx.resume(); this.playbackState = 'playing'; } }
  stop() { if (this.activeSource) { try { this.activeSource.stop(); } catch (e) {} this.activeSource = null; } this.playbackState = 'stopped'; }
  getPlaybackState() { return this.playbackState; }
}

export const ttsService = new TTSService();
