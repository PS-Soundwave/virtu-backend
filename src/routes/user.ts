import { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { authenticateRequest, type AuthenticatedRequest } from '../middleware/auth.js';

interface SearchQueryParams {
  q: string;
}

interface ValidateQueryParams {
  username: string;
}

export async function userRoutes(fastify: FastifyInstance) {
  // Search users by username
  fastify.get('/users/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 30 }
        }
      }
    }
  }, async (request: FastifyRequest<{Querystring: SearchQueryParams}>, reply) => {
    try {
      const query = decodeURIComponent(request.query.q).trim();
      
      // Basic input validation
      if (!query || query.length < 1) {
        reply.code(400).send({ error: 'Invalid search query' });
        return;
      }

      // Escape special characters for LIKE query
      const escapedQuery = query.replace(/[%_]/g, '\\$&');
      
      // Get username suggestions
      const suggestions = await db
        .selectFrom('users')
        .select(['username'])
        .where('username', 'like', `${escapedQuery}%`) // Starts with query
        .orderBy('username')
        .limit(10)
        .execute();

      request.log.info(`Found ${suggestions.length} suggestions for ${query}`);

      reply.send({
        suggestions: suggestions.map(u => u.username)
      });
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Validate username availability
  fastify.get('/users/validate', {
    schema: {
      querystring: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 30 }
        }
      }
    }
  }, async (request: FastifyRequest<{Querystring: ValidateQueryParams}>, reply) => {
    try {
      const username = decodeURIComponent(request.query.username).trim();
      
      // Basic input validation
      if (!username || username.length < 3 || username.length > 30) {
        reply.code(400).send({ error: 'Invalid username format' });
        return;
      }

      // Check if username exists
      const existingUser = await db
        .selectFrom('users')
        .select(['username'])
        .where('username', '=', username)
        .executeTakeFirst();

      reply.send({
        exists: !!existingUser
      });
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

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
