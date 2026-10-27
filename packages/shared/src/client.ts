/**
 * Typed API Client for AICTE Control Tower API
 * Generated and strongly typed client for backend consumption.
 */
import type { ApiResponse } from './types/index.js';

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void;
}

export class AicteApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    const token = this.config.getAccessToken ? await this.config.getAccessToken() : null;

    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401 && this.config.onUnauthorized) {
      this.config.onUnauthorized();
    }

    if (!response.ok) {
      const errorJson = (await response.json().catch(() => ({}))) as Record<string, any>;
      throw {
        status: response.status,
        code: errorJson.code || 'API_ERROR',
        message: errorJson.message || response.statusText,
        details: errorJson.details,
        requestId: errorJson.requestId,
      };
    }

    if (response.status === 204) {
      return { success: true, data: null as any, timestamp: new Date().toISOString() };
    }

    return response.json() as Promise<ApiResponse<T>>;
  }

  // Auth endpoints
  async login(payload: { email: string; password: string; totpCode?: string }) {
    return this.request<{ accessToken: string; user: any }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getMe() {
    return this.request<any>('/api/v1/auth/me');
  }

  // Applications endpoints
  async listApplications(params?: Record<string, string | number>) {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : '';
    return this.request<{ items: any[]; total: number }>('/api/v1/applications' + query);
  }

  async getApplication(id: string) {
    return this.request<any>(`/api/v1/applications/${id}`);
  }

  async validateApplication(id: string) {
    return this.request<any>(`/api/v1/applications/${id}/validate`, { method: 'POST' });
  }

  async submitApplication(id: string, expectedVersion?: number) {
    return this.request<any>(`/api/v1/applications/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    });
  }

  async transitionApplication(id: string, payload: { action: string; reason?: string; clauseId?: string; expectedVersion?: number }) {
    return this.request<any>(`/api/v1/applications/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Clocks
  async getApplicationClocks(id: string) {
    return this.request<any>(`/api/v1/applications/${id}/clocks`);
  }

  // Tasks
  async getMyTasks() {
    return this.request<any>('/api/v1/tasks/my');
  }

  // Compliance
  async getComplianceRadar(params?: Record<string, any>) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    return this.request<any>('/api/v1/compliance/radar' + query);
  }

  // Audit
  async verifyAuditChain() {
    return this.request<any>('/api/v1/audit/verify');
  }
}
