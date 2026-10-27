export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  institutionId?: string;
  regionId?: string;
}

export interface SseEventPayload<T = unknown> {
  type: string;
  channel: string;
  data: T;
  timestamp: string;
}
