import { INITIAL_CV_DATA, type CVData } from './types';

const API_BASE = '/api';

// Content saved before a section existed may lack it; guarantee arrays so the
// UI never has to defend against undefined.
function withDefaults(data: Partial<CVData>): CVData {
  return {
    ...INITIAL_CV_DATA,
    ...data,
    languages: data.languages ?? [],
    certifications: data.certifications ?? [],
  };
}

export async function fetchCVData(): Promise<CVData> {
  try {
    const res = await fetch(`${API_BASE}/content`);
    if (res.status === 404) return INITIAL_CV_DATA;
    if (!res.ok) throw new Error('Failed to fetch data');
    return withDefaults(await res.json());
  } catch (error) {
    console.error(error);
    return INITIAL_CV_DATA; // Fallback
  }
}

export type SaveResult = 'ok' | 'unauthorized' | 'error';

// /api/admin/* sits behind Cloudflare Access. Without a valid Access session the
// request is answered with a redirect to the sign-in page (or 401/403), so we use
// `redirect: 'manual'` and treat all of those as "not signed in".
const isUnauthorized = (res: Response) =>
  res.type === 'opaqueredirect' || res.status === 401 || res.status === 403;

export async function saveCVData(data: CVData): Promise<SaveResult> {
  try {
    const res = await fetch(`${API_BASE}/admin/content`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) return 'ok';
    return isUnauthorized(res) ? 'unauthorized' : 'error';
  } catch (error) {
    console.error(error);
    return 'error';
  }
}

export async function verifySession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/verify`, { redirect: 'manual' });
    return res.ok;
  } catch {
    return false;
  }
}
