import { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../firebase.js';

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    firebaseUid: string;
  };
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }

  const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    (request as AuthenticatedRequest).user = {
      firebaseUid: decodedToken.uid
    };
  } catch (error) {
    request.log.error('Firebase auth error:', error);
    reply.code(401).send({ error: 'Invalid authentication token' });
    return;
  }
}
