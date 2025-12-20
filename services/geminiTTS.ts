import { GoogleGenAI } from "@google/genai";
import { decode, decodeAudioData, createWavBlob } from "../utils/audioHelper";

export class TTSService {
  private ai: GoogleGenAI;
  private playbackState: 'playing' | 'paused' | 'stopped' = 'stopped';
  private audioContext: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;

  constructor() {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
    this.ai = new GoogleGenAI({ apiKey });
  }

  async synthesize(config: any) {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ parts: [{ text: config.text }] }],
        config: {
          responseModalities: ["audio"], // Sửa lỗi 400 dứt điểm
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
        }
      });
      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!data) throw new Error("No data");
      const pcmBytes = decode(data);
      const audioBuffer = await decodeAudioData(pcmBytes, ctx, 24000, 1);
      return { audioBuffer, blob: createWavBlob(pcmBytes, 24000), base64: data };
    } catch (e) { console.error(e); throw e; }
  }
  
  stop() { if (this.activeSource) this.activeSource.stop(); this.playbackState = 'stopped'; }
  getPlaybackState() { return this.playbackState; } // Sửa lỗi treo App
}
export const ttsService = new TTSService();
