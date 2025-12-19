
export enum VoiceName {
  ZEPHYR = 'Zephyr',
  PUCK = 'Puck',
  CHARON = 'Charon',
  KORE = 'Kore',
  FENRIR = 'Fenrir',
  AOEDE = 'Aoede'
}

export interface TTSConfig {
  voiceName: VoiceName;
  text: string;
  stylePrompt?: string;
  pitch: number;
  referenceProfile?: string; // Đặc điểm giọng nói đã phân tích
}

export interface VoiceOption {
  id: VoiceName | string;
  name: string;
  description: string;
  gender: 'Male' | 'Female' | 'Custom';
  isCloned?: boolean;
}

export interface HistoryItem {
  id: string;
  text: string;
  voiceName: string;
  timestamp: number;
  audioBuffer: AudioBuffer;
  blob: Blob;
}
