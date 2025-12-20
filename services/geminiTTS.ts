import { GoogleGenAI } from "@google/genai"; // Changed to match your installed library
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
    // Uses the Vite-compatible environment variable
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
      // Fixes the "INVALID_ARGUMENT" error by using the correct audio modality structure
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash", 
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: ["audio"], // Explicitly requested as audio
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
      if (!base64Audio) throw new Error("API error: No audio data received");

      const pcmBytes = decode(base64Audio);
      const audioBuffer = await decodeAudioData(pcmBytes, ctx, 24000, 1);
      const blob = createWavBlob(pcmBytes, 24000);

      return { audioBuffer, blob, base64: base64Audio };
    } catch (error: any) {
      console.error("TTS Error:", error);
      throw error;
    }
  }

  // ... rest of your play/stop methods
  stop() { if (this.activeSource) { try { this.activeSource.stop(); } catch (e) {} this.activeSource = null; } this.playbackState = 'stopped'; }
}

export const ttsService = new TTSService();
