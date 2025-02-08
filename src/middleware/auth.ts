import { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../firebase.js';

declare module 'fastify' {
  export interface FastifyRequest {
    uid?: string;
  }
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401);
  }

  const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    request.uid = decodedToken.uid;
  } catch (error) {
    request.log.error('Firebase auth error:', error);
    return reply.code(401);
  }
}
