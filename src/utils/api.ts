
import { INITIAL_CV_DATA, type CVData } from './types';

const API_BASE = '/api';

export async function fetchCVData(): Promise<CVData> {
  try {
    const res = await fetch(`${API_BASE}/content`);
    if (!res.ok) {
        if (res.status === 404) return INITIAL_CV_DATA;
        throw new Error("Failed to fetch data");
    }
    return await res.json();
  } catch (error) {
    console.error(error);
    return INITIAL_CV_DATA; // Fallback
  }
}

export async function saveCVData(data: CVData): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (error) {
    console.error(error);
    return false;
  }
}

export async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    return res.ok;
  } catch (error) {
    return false;
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      return data;
    } catch (error) {
      return { success: false, error: "Network error" };
    }
  }
