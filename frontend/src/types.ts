export type View = "workflow" | "landing" | "overview" | "projects" | "project" | "atlas" | "runs" | "creative" | "retrieval" | "images" | "music" | "production" | "library" | "news" | "connections" | "notfound";
export type ProjectTab = "brief" | "manuscript" | "canon" | "pipeline";

export const MEDIA = ["Novel", "Short story", "Stage play", "Screenplay", "Audio drama", "Comic script"] as const;
export type Medium = (typeof MEDIA)[number];

export type SceneState = "Draft" | "Provisional" | "In review" | "Accepted";
export type Dimension = "Story" | "Rhetoric" | "Memory";
export type Severity = "Blocking" | "Major" | "Minor";
export type Finding = { id: string; dimension: Dimension; severity: Severity; quote: string; note: string; status: "Open" | "Repaired" | "Waived"; source: "Mechanical check" | "Reviewer" };
export type Scene = { id: string; chapter: number; title: string; pov: string; location: string; content: string; state: SceneState; findings: Finding[]; acceptedHash?: string; minutes: number; night: boolean };

export type Arc = { belief: string; pressure: string; choice: string; change: string };
export type Character = { id: string; name: string; goal: string; fear: string; voice: string; arc: Arc };
export type Brief = {
  premise: string; medium: Medium; genre: string; tone: string; pov: string;
  themes: string[]; worldRules: string[]; mustAvoid: string[];
  chapters: number; scenesPerChapter: number; wordMin: number; wordMax: number; lengthMode: "Strict" | "Guided";
  characters: Character[];
};

export const FACT_KINDS = ["Event", "Belief", "Claim", "Resource", "Relationship", "Thread"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type Fact = { id: string; kind: FactKind; text: string; holders: string[]; sceneId: string; state: "Accepted" | "Provisional" | "Quarantined"; thread?: "Setup" | "Escalation" | "Payoff" };

export type Version = { id: string; label: string; created: string; scenes: Scene[] };
export type Project = { id: string; title: string; owner: string; color: string; updated: string; brief: Brief; scenes: Scene[]; canon: Fact[]; versions: Version[]; revision?: string; folder?: string; imported?: boolean };

export type ModeId = "sequential" | "planned-parallel" | "parallel-scenes" | "living-universe" | "classic-expansion";
export type RunStatus = "Queued" | "Running" | "Succeeded" | "Failed" | "Cancelled" | "Interrupted";
export type RunEvent = { at: string; text: string };
export type Run = { id: string; projectId: string; mode: ModeId; status: RunStatus; progress: number; stage: string; started: string; events: RunEvent[]; recoveredFrom?: string };

export type CreativeMode = "Ideas" | "Draft" | "Review" | "Revise";
export type CreativeResult = { id: string; mode: CreativeMode; input: string; output: string; rounds: number; words: number; context: boolean; created: string; source?: AtlasSource };
/** A story picked on the atlas and carried into the creative workspace as ideation context. */
export type AtlasApproach = "Retelling" | "Inspired by";
export type AtlasSource = { id: string; title: string; tradition: string; place: string; approach: AtlasApproach; mechanism: string; instruction: string; analysis: string };
export type CreativeSeed = { mode: CreativeMode; input: string; source: AtlasSource };
export type Idea = { id: string; label: string; title: string; body: string; color: string };

export const IMAGE_SUBJECTS = ["Character", "Scene", "Location", "Prop / costume", "Storyboard frame", "Custom"] as const;
export const IMAGE_STYLES = ["Automatic", "Documentary film still", "Period film still", "Noir photography", "Grounded science fiction", "Gouache storybook", "Ink and watercolor", "Oil painting", "Pencil storyboard", "Cinematic realism"] as const;
export type ImageRecord = { id: string; projectId: string; subject: string; prompt: string; style: string; provider: string; model: string; shape: string; seed: number; natural: boolean; fallback?: string; created: string };

export type AudioMode = "Ambient soundscape" | "Cinematic score" | "Song";
export type Track = { id: string; projectId: string; mode: AudioMode; cue: string; layers: string[]; seconds: number; status: "Saved" | "Needs connection"; created: string };

export type Store = { projects: Project[]; runs: Run[]; ideas: Idea[]; creative: CreativeResult[]; images: ImageRecord[]; tracks: Track[]; pins: Pin[] };
export type Pin = { id: string; projectId: string; recordId: string; scope: "Story" | "Chapter" | "Scene"; purpose: string; title?: string };

export type AtlasBasis = "origin" | "setting";
export type AtlasPin = { id: string; title: string; tradition: string; section: string; attribution: string; region: string; place: string; basis: AtlasBasis; lat: number; lng: number; mechanism: string; themes: string[]; teaser: string; detailed: boolean; episodes: number };
export type AtlasEpisode = { id: string; title: string; record_type: string; analysis: string; instruction: string; mechanism: string; summary: string | null };
export type AtlasStory = AtlasPin & {
  analysis: string; instruction: string; techniques: string[]; keywords: string[]; summary: string | null; genre: string[]; tone: string | null;
  key_ideas: string[]; characters: string[]; context: string | null; threads: string[]; sensory: string[]; adaptability: string | null;
  version_notes: string | null; notes: string[]; verification: string; children: AtlasEpisode[];
};
export type AtlasIndex = { corpus: string; regions: string[]; stories: AtlasPin[] };
