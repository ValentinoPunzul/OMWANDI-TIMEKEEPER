// api.js
import { state } from './state.js';

const API_BASE = "/api";

export async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    if (state.idToken) {
      headers['Authorization'] = `Bearer ${state.idToken}`;
    }
  
    const res = await fetch(url, { ...options, headers });
  
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }
    return res.json();
  }