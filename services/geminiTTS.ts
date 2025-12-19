
import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, VoiceName } from "../types";
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

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
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
    return "normal pitch";
  }

  async analyzeVoice(audioBase64: string): Promise<string> {
    const prompt = "Analyze this voice clip carefully. Describe its vocal characteristics in detail: gender, age, tone (breathy, raspy, nasal, etc.), emotional baseline, and unique cadence. Return only a concise descriptive paragraph that can be used as a style guide for a TTS engine.";
    
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "audio/wav", data: audioBase64 } }
            ]
          }
        ],
      });
      return response.text || "Standard expressive voice.";
    } catch (error) {
      console.error("Voice Analysis Error:", error);
      throw new Error("Failed to analyze voice sample.");
    }
  }

  async checkSpelling(text: string): Promise<string> {
    const prompt = `You are a professional proofreader. Correct any spelling or grammar mistakes in the text provided below. 
    IMPORTANT: 
    1. Preserve all markers in parentheses like (happy), (laughing), or (reverb: high). DO NOT modify or remove them.
    2. Maintain the overall tone and meaning.
    3. Return ONLY the corrected text, no explanations.

    TEXT TO CORRECT:
    ${text}`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text || text;
    } catch (error) {
      console.error("Spell Check Error:", error);
      throw new Error("Could not check spelling. Please try again.");
    }
  }

  async concatenateAudioBuffers(buffers: AudioBuffer[]): Promise<AudioBuffer> {
    const ctx = this.getAudioContext();
    const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
    const result = ctx.createBuffer(
      buffers[0].numberOfChannels,
      totalLength,
      buffers[0].sampleRate
    );

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
    
    const baseStyle = config.stylePrompt || 'Natural';
    const cloneStyle = config.referenceProfile ? `ADOPT VOICE CHARACTERISTICS: ${config.referenceProfile}` : '';

    const promptText = `Voice Actor Persona: Professional & Ultra-Expressive Audio Engineer.
Tone: ${pitchDesc}, Style: ${baseStyle}.
${cloneStyle}

Script Interpretation Rules for markers in (parentheses):
DO NOT speak the literal text inside the parentheses. Use them as instructions:

1. EMOTION: (disdainful), (unhappy), (anxious), (hysterical), (indifferent), (impatient), (guilty), (scornful), (panicked), (furious), (reluctant), (keen), (disapproving), (negative), (denying), (astonished), (serious), (sarcastic), (conciliative), (comforting), (sincere), (sneering), (hesitating), (yielding), (painful), (awkward), (amused).
2. TONE CONTROL: (in a hurry tone), (shouting), (screaming), (whispering), (soft tone).
3. PHYSICAL EFFECTS: (laughing), (chuckling), (sobbing), (crying loudly), (sighing), (panting), (groaning), (crowd laughing), (background laughter), (audience laughing).
4. AUDIO PROCESSING EFFECTS: (reverb), (echo), (distortion). 
   - These markers can include intensity: (reverb: low), (reverb: high), (echo: subtle), (distortion: heavy).
   - Apply these audio characteristics to the speech following the marker. Reverb should sound like a room ambience, Echo should sound like delay/reflections, Distortion should sound like radio static or overdrive.

IMPORTANT: When you see (laughing), you should produce the sound of a person laughing. When you see (reverb), adjust the acoustic environment of the generated audio.

SCRIPT:
${config.text}`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
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
      if (!base64Audio) throw new Error("No audio data received.");

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
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => { if (this.activeSource === source) { this.activeSource = null; onEnded?.(); } };
    this.activeSource = source;
    source.start();
  }

  stop() {
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (e) {}
      this.activeSource = null;
    }
  }
}

export const ttsService = new TTSService();
