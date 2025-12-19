
export enum VoiceName {
  ZEPHYR = 'Zephyr',
  PUCK = 'Puck',
  CHARON = 'Charon',
  KORE = 'Kore',
  FENRIR = 'Fenrir',
  AOEDE = 'Aoede'
}

export enum Language {
  AUTO = 'Tự động',
  VIETNAMESE = 'Tiếng Việt',
  JAPANESE = 'Tiếng Nhật',
  ENGLISH = 'Tiếng Anh'
}

export interface TTSConfig {
  voiceName: VoiceName;
  text: string;
  language: Language;
  stylePrompt?: string;
  pitch: number;
  speed: number;
  referenceProfile?: string;
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
