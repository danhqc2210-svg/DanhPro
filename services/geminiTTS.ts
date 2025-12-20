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
    // SỬA: Phải dùng import.meta.env cho dự án Vite trên Vercel
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

  async analyzeVoice(audioBase64: string): Promise<string> {
    try {
      const result = await this.ai.generateContent([
        { text: "Analyze this voice." },
        { inlineData: { mimeType: "audio/wav", data: audioBase64 } }
      ]);
      return result.response.text() || "Professional voice.";
    } catch (error) {
      return "Voice analysis error.";
    }
  }

  async synthesize(config: TTSConfig): Promise<TTSRunResult> {
    const ctx = this.getAudioContext();
    const promptText = `HÀNH ĐỘNG: Diễn viên lồng tiếng chuyên nghiệp. KỊCH BẢN: ${config.text}`;

    try {
      // SỬA LỖI INVALID_ARGUMENT: Chuyển sang cấu trúc generationConfig
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

      if (!base64Audio) throw new Error("No audio data");

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
