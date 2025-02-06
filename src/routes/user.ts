import { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { authenticateRequest, type AuthenticatedRequest } from '../middleware/auth.js';

export async function userRoutes(fastify: FastifyInstance) {
  // Get current user
  fastify.get('/user/me', { 
    preHandler: authenticateRequest 
  }, async (request: FastifyRequest, reply) => {
    try {
      const { firebaseUid } = (request as AuthenticatedRequest).user;

      const user = await db
        .selectFrom('users')
        .select(['username'])
        .where('firebase_id', '=', firebaseUid)
        .executeTakeFirst();

      if (!user) {
        reply.code(404).send({ 
          error: 'User not found'
        });
        return;
      }

      reply.send({
        username: user.username
      });
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Update or create user
  fastify.put('/user/me', {
    preHandler: authenticateRequest,
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 30 }
        }
      }
    }
  }, async (request: FastifyRequest, reply) => {
    try {
      const { firebaseUid } = (request as AuthenticatedRequest).user;
      const { username } = request.body as { username: string };

      // Check if username is already taken by another user
      const existingUser = await db
        .selectFrom('users')
        .select(['firebase_id'])
        .where('username', '=', username)
        .executeTakeFirst();

      if (existingUser && existingUser.firebase_id !== firebaseUid) {
        reply.code(409).send({ error: 'Username already taken' });
        return;
      }

      // Upsert user
      const result = await db
        .insertInto('users')
        .values({
          firebase_id: firebaseUid,
          username
        })
        .onConflict(oc => oc
          .column('firebase_id')
          .doUpdateSet({ username })
        )
        .returning(['username'])
        .executeTakeFirst();

      reply.send({
        username: result?.username
      });
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
