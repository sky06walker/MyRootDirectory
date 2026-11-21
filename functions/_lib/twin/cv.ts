import { INITIAL_CV_DATA, type CVData } from "../../../src/utils/types";

const CV_KEY = "cv_content";
const FAQ_KEY = "twin_faq";
const KILL_KEY = "twin_disabled";
const CACHE_MS = 30_000;
export const FAQ_MAX_CHARS = 8000;

interface KvReader {
  get(key: string): Promise<string | null>;
}

/** What the twin may know and say: the CV minus photo, ids, phone number and street address. */
export interface TwinCv {
  profile: { name: string; title: string; summary: string; location: string; url: string };
  experience: { role: string; company: string; startDate: string; endDate: string; description: string }[];
  education: { institution: string; degree: string; year: string }[];
  skills: { name: string; category: string; level?: number }[];
  languages: { language: string; proficiency: string }[];
  certifications: { name: string; year: string }[];
  contact: { email: string; linkedin?: string; github?: string; website?: string };
}

export function toTwinCv(cv: CVData): TwinCv {
  return {
    profile: {
      name: cv.profile.name,
      title: cv.profile.title,
      summary: cv.profile.summary,
      location: cv.profile.location,
      url: cv.profile.url,
    },
    experience: cv.experience.map((e) => ({
      role: e.role,
      company: e.company,
      startDate: e.startDate,
      endDate: e.endDate,
      description: e.description,
    })),
    education: cv.education.map((e) => ({ institution: e.institution, degree: e.degree, year: e.year })),
    skills: cv.skills.map((s) => ({ name: s.name, category: s.category, level: s.level })),
    languages: cv.languages.map((l) => ({ language: l.language, proficiency: l.proficiency })),
    certifications: cv.certifications.map((c) => ({ name: c.name, year: c.year })),
    contact: {
      email: cv.contact.email,
      linkedin: cv.contact.linkedin,
      github: cv.contact.github,
      website: cv.contact.website,
    },
  };
}

const isStringArrayEntry = (v: unknown): boolean => typeof v === "object" && v !== null;

/** Accepts a stored CV only if it has the shape the twin relies on; otherwise null. */
export function parseStoredCv(raw: string): CVData | null {
  try {
    const data = JSON.parse(raw) as Partial<CVData>;
    if (
      !data ||
      typeof data.profile?.name !== "string" ||
      typeof data.contact?.email !== "string" ||
      !Array.isArray(data.experience) ||
      !data.experience.every(isStringArrayEntry) ||
      !Array.isArray(data.education) ||
      !Array.isArray(data.skills)
    ) {
      return null;
    }
    return {
      ...INITIAL_CV_DATA,
      ...data,
      languages: data.languages ?? [],
      certifications: data.certifications ?? [],
    } as CVData;
  } catch {
    return null;
  }
}

// 30 s in-isolate caches keep KV reads off the hot path; KV itself is eventually consistent,
// so an admin edit reaches answers within about 1-2 minutes (documented in the plan).
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const resetTwinCaches = (): void => cache.clear();

/** Live CV from KV, falling back to the built-in CV (same fallback as the public page). */
export const loadCv = (kv: KvReader): Promise<CVData> =>
  cached("cv", async () => {
    const raw = await kv.get(CV_KEY);
    return (raw && parseStoredCv(raw)) || INITIAL_CV_DATA;
  });

/** Owner-authored extra facts (stories, working style, notice period if they want it answered). */
export const loadFaq = (kv: KvReader): Promise<string> =>
  cached("faq", async () => ((await kv.get(FAQ_KEY)) ?? "").slice(0, FAQ_MAX_CHARS));

/** Fast kill switch: `wrangler kv key put twin_disabled 1 --binding CV_DATA --remote`. */
export const isKilled = (kv: KvReader): Promise<boolean> =>
  cached("kill", async () => (await kv.get(KILL_KEY)) === "1");
