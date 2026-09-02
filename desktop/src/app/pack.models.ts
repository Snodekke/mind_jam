export type PackGameType = "topic-clash" | "crowd-code";
export type PackTag = "people-society" | "nature-universe" | "technology-inventions" | "art-culture" | "mass-media-entertainment" | "sport-activity" | "economy-business" | "logic-abstraction";
export type QuestionMediaType = "image" | "video" | "audio";
export type CrowdRoundKind = "simple" | "double" | "triple" | "reverse" | "big";

export interface PackMedia {
  type: QuestionMediaType;
  name: string;
  mimeType: string;
  dataUrl: string;
  durationSeconds?: number;
}

export interface PackQuestion {
  id: string;
  text: string;
  value: number | null;
  isCatInBag: boolean;
  catValue: number | null;
  media: PackMedia | null;
  answerText: string;
  answerImage: PackMedia | null;
}

export interface PackTheme {
  id: string;
  name: string;
  questions: PackQuestion[];
}

export interface PackRound {
  id: string;
  name: string;
  themes: PackTheme[];
}

export interface CrowdAnswer {
  id: string;
  text: string;
  points: number;
}

export interface CrowdQuestion {
  id: string;
  text: string;
  image: PackMedia | null;
  answers: CrowdAnswer[];
}

export interface CrowdRound {
  id: string;
  name: string;
  kind: CrowdRoundKind;
  questions: CrowdQuestion[];
}

export interface GamePack {
  schemaVersion: 1;
  id: string;
  name: string;
  gameType: PackGameType;
  createdAt: string;
  updatedAt: string;
  tags: PackTag[];
  rounds: PackRound[];
  finalThemes: PackTheme[];
  crowdRounds: CrowdRound[];
}

export interface PackSummary {
  id: string;
  fileName: string;
  name: string;
  gameType: PackGameType;
  tags: PackTag[];
  updatedAt: string;
  roundCount: number;
}

export interface PacksListing {
  directory: string;
  packs: PackSummary[];
}
