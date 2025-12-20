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
    // SỬA: Dùng import.meta.env để Vercel build được bản Production
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; 
    const genAI = new GoogleGenerativeAI(apiKey);
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

  async synthesize(config: TTSConfig): Promise<TTSRunResult> {
    const ctx = this.getAudioContext();
    const promptText = `HÀNH ĐỘNG: Diễn viên lồng tiếng chuyên nghiệp. KỊCH BẢN: ${config.text}`;

    try {
      // SỬA: Cấu trúc generationConfig chuẩn để tránh lỗi INVALID_ARGUMENT
      const result = await this.ai.generateContent({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: {
          responseModalities: ["audio"], 
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

  // ... (Các hàm play, stop giữ nguyên như cũ)
}

export const ttsService = new TTSService();
