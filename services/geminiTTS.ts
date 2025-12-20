import { GoogleGenAI } from "@google/genai";
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
    // Đảm bảo khớp với Key bạn vừa tạo trên Vercel
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

  async synthesize(config: TTSConfig): Promise<TTSRunResult> {
    const ctx = this.getAudioContext();
    const promptText = `HÀNH ĐỘNG: Diễn viên lồng tiếng chuyên nghiệp. KỊCH BẢN: ${config.text}`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          // Sửa lỗi INVALID_ARGUMENT (400)
          responseModalities: ["audio"], 
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

  async play(audioBuffer: AudioBuffer, onEnded?: () => void) {
    this.stop();
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => { this.playbackState = 'stopped'; onEnded?.(); };
    this.activeSource = source;
    this.playbackState = 'playing';
    source.start();
  }

  stop() { if (this.activeSource) { this.activeSource.stop(); this.activeSource = null; } this.playbackState = 'stopped'; }
  
  // Sửa lỗi "getPlaybackState is not a function"
  getPlaybackState() { return this.playbackState; }
}

export const ttsService = new TTSService();
