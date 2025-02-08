import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { authenticateRequest } from '../middleware/auth.js';
import { Video } from './video.js';

type SearchQueryParams = {
  q: string;
}

type GetUserQueryParams = {
  username: string;
}

type User = {
  username: string;
  id: string;
}

export async function userRoutes(fastify: FastifyInstance) {
  // Search users by username
  fastify.get<{Querystring: SearchQueryParams, Reply: User[]}>('/user/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const query = decodeURIComponent(request.query.q).trim();
      
      // Basic input validation
      if (!query || query.length < 1) {
        return reply.code(400);
      }

      // Escape special characters for LIKE query
      const escapedQuery = query.replace(/[%_]/g, '\\$&');
      
      // Get username suggestions
      const suggestions = await db
        .selectFrom('users')
        .select(['username', 'id'])
        .where('username', 'like', `${escapedQuery}%`) // Starts with query
        .orderBy('username')
        .limit(10)
        .execute();

      return reply.send(suggestions);
    } catch (error) {
      request.log.error(error);
      return reply.code(500);
    }
  });

  // Validate username availability
  fastify.get<{Querystring: GetUserQueryParams, Reply: User}>('/user', {
    schema: {
      querystring: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const username = decodeURIComponent(request.query.username).trim();

      // Check if username exists
      const existingUser = await db
        .selectFrom('users')
        .select(['username', 'id'])
        .where('username', '=', username)
        .executeTakeFirst();

      if (!existingUser) {
        return reply.code(404);
      }

      return reply.send(existingUser);
    } catch (error) {
      request.log.error(error);
      return reply.code(500);
    }
  });

  // Get current user
  fastify.get<{Reply: User}>('/user/me', { 
    preHandler: authenticateRequest 
  }, async (request, reply) => {
    try {
      const user = await db
        .selectFrom('users')
        .select(['username', 'id'])
        .where('firebase_id', '=', request.uid!)
        .executeTakeFirst();

      if (!user) {
        return reply.code(404);
      }

      return reply.send(user);
    } catch (error) {
      request.log.error(error);
      return reply.code(500);
    }
  });

  // Update or create user
  fastify.patch<{Body: { username: string }}>('/user/me', {
    preHandler: authenticateRequest,
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const firebaseUid = request.uid!;
      const { username } = request.body;

      // Check if username is already taken by another user
      const existingUser = await db
        .selectFrom('users')
        .select(['firebase_id'])
        .where('username', '=', username)
        .executeTakeFirst();

      if (existingUser && existingUser.firebase_id !== firebaseUid) {
        return reply.code(409);
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
        .returning(['username', 'id'])
        .executeTakeFirst();
    } catch (error) {
      request.log.error(error);
      return reply.code(500);
    }
  });

   // Get videos uploaded by a specific user
   fastify.get<{Params: { userId: string }, Reply: Video[]}>('/user/:userId/video', async (request, reply) => {
    const videos = await db
      .selectFrom('videos')
      .where('uploader', '=', request.params.userId)
      .select(['id', 'key'])
      .orderBy('created_at', 'desc')
      .execute();

    return reply.send(videos);
  });
}
