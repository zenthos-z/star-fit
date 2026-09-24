export interface ShanShuiConfig {
  type: 'shanshui';
  name: string;
  style: string;
  background: string;
  texture: string;
  lighting: string;
}

export interface BauhausConfig {
  type: 'bauhaus';
  name: string;
  style: string;
  background: string;
  texture: string;
}

export interface AcidConfig {
  type: 'acid';
  id: string;
  name: string;
  style: string;
  background: string;
  texture: string;
  lighting: string;
  character: string;
}

export type StyleConfig = ShanShuiConfig | BauhausConfig | AcidConfig;
export type VibeConfig = Record<string, any>;
