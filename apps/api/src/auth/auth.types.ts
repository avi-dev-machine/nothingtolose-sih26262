import type { FastifyRequest } from 'fastify';
import type { Actor } from '../common/actor.js';

export interface AuthenticatedRequest extends FastifyRequest {
  user: Actor;
}
